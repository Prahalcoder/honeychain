import crypto from 'node:crypto'

import db from '../database/database.js'
import { sealPendingBlock } from './blockchain.js'
import { appendTraceabilityEvent } from './traceabilityLog.js'
import { lockNamed } from './ledgerLock.js'

// Cloned-QR detection. A counterfeiter's cheapest attack is to photocopy the QR label of one genuine jar onto
// many fake jars: every copy then "verifies" as genuine. A real jar, though, is bought by one household and
// scanned by a handful of phones in one place. So every consumer scan on the public verify page is logged
// (a random id the buyer's browser keeps, and the location only if the buyer chose to share it, rounded to about
// a kilometre), and the pattern is checked on every scan:
//
//   IMPOSSIBLE_TRAVEL  two different phones scanned it far apart, too quickly for one jar to have travelled
//   MANY_PLACES        different phones scanned it in 3 or more places at least 100 km from each other
//   TOO_MANY_PHONES    more distinct phones than one household plausibly has
//   CONSUMER_REPORT    a buyer reported the jar as suspicious from the verify page
//
// Any of these opens an alert for the regional KVIC officer, and the verify page warns the next buyer straight
// away. The officer either clears the jar or confirms the copies, which marks the code CLONED on the chain.
export const RULES = {
  IMPOSSIBLE_TRAVEL: 'Scanned far apart, too quickly for one jar to travel',
  MANY_PLACES: 'Scanned in many far-apart places by different phones',
  TOO_MANY_PHONES: 'Scanned by more phones than one jar is likely to meet',
  CONSUMER_REPORT: 'Reported as suspicious by a buyer',
}

export const LIMITS = {
  fastestKmh: 800,
  minDistanceKm: 100,
  placesForAlert: 3,
  maxPhones: 6,
  dedupeMinutes: 10,
}

export class GuardError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

const DEVICE_ID = /^[A-Za-z0-9-]{8,64}$/
const round2 = (value) => Math.round(value * 100) / 100
const now = () => new Date().toISOString()

export function distanceKm(a, b) {
  const rad = (degrees) => (degrees * Math.PI) / 180
  const dLat = rad(b.latitude - a.latitude)
  const dLng = rad(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(h))
}

const hashIp = (ip) => (ip ? crypto.createHash('sha256').update(`${ip}|${process.env.JWT_SECRET || 'honeychain'}`).digest('hex').slice(0, 16) : null)

async function packOwner(packId) {
  return await db.prepare(`
    SELECT p.pack_id, p.status, b.org_id FROM packs p
    JOIN pack_batches pb ON pb.id = p.pack_batch_id JOIN batches b ON b.id = pb.batch_id WHERE p.pack_id = ?
  `).get(packId)
}

function cleanLocation({ latitude, longitude, accuracyM }) {
  const lat = Number(latitude)
  const lng = Number(longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null
  const accuracy = Number(accuracyM)
  // A location only known to within 25 km says nothing useful about where the jar is.
  if (Number.isFinite(accuracy) && accuracy > 25000) return null
  return { latitude: round2(lat), longitude: round2(lng), accuracyM: Number.isFinite(accuracy) ? Math.round(accuracy) : null }
}

async function openAlert(pack, reason, detail, source = 'AUTO') {
  await db.prepare(`
    INSERT INTO jar_alerts (pack_id, org_id, reason, source, detail_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (pack_id, reason) WHERE status = 'OPEN' DO UPDATE SET detail_json = excluded.detail_json
  `).run(pack.pack_id, pack.org_id, reason, source, JSON.stringify(detail), now())
}

// The rules above, run on the scans of one jar (oldest first). `travelSince`: only a scan after this time can
// complete an impossible trip (used once an officer has cleared an earlier one).
export function evaluate(scans, { travelSince = '' } = {}) {
  const findings = []
  const located = scans.filter((scan) => scan.latitude !== null && scan.latitude !== undefined)

  for (let i = 1; i < located.length && !findings.some((item) => item.reason === 'IMPOSSIBLE_TRAVEL'); i += 1) {
    const later = located[i]
    if (travelSince && later.scanned_at <= travelSince) continue
    for (let j = i - 1; j >= 0; j -= 1) {
      const earlier = located[j]
      if (earlier.device_id === later.device_id) continue
      const km = distanceKm(earlier, later)
      if (km < LIMITS.minDistanceKm) continue
      const hours = Math.max((Date.parse(later.scanned_at) - Date.parse(earlier.scanned_at)) / 3600000, 1 / 60)
      const kmh = km / hours
      if (kmh > LIMITS.fastestKmh) {
        findings.push({
          reason: 'IMPOSSIBLE_TRAVEL',
          detail: {
            distanceKm: Math.round(km), minutesApart: Math.round(hours * 60), impliedSpeedKmh: Math.round(kmh),
            first: { at: earlier.scanned_at, latitude: earlier.latitude, longitude: earlier.longitude },
            second: { at: later.scanned_at, latitude: later.latitude, longitude: later.longitude },
          },
        })
        break
      }
    }
  }

  // Places: one representative scan per phone, grouped into clusters 100 km apart.
  const places = []
  for (const scan of located) {
    const near = places.find((place) => distanceKm(place, scan) < LIMITS.minDistanceKm)
    if (near) near.devices.add(scan.device_id)
    else places.push({ latitude: scan.latitude, longitude: scan.longitude, devices: new Set([scan.device_id]), firstAt: scan.scanned_at })
  }
  const distinctPlaces = places.filter((place) => place.devices.size > 0)
  if (distinctPlaces.length >= LIMITS.placesForAlert) {
    const devicesAcross = new Set(distinctPlaces.flatMap((place) => [...place.devices]))
    if (devicesAcross.size >= LIMITS.placesForAlert) {
      findings.push({
        reason: 'MANY_PLACES',
        detail: { places: distinctPlaces.slice(0, 10).map((place) => ({ latitude: place.latitude, longitude: place.longitude, phones: place.devices.size, firstAt: place.firstAt })) },
      })
    }
  }

  const phones = new Set(scans.map((scan) => scan.device_id)).size
  if (phones > LIMITS.maxPhones) findings.push({ reason: 'TOO_MANY_PHONES', detail: { phones, scans: scans.length } })

  return findings
}

async function scansOf(packId) {
  return await db.prepare('SELECT device_id, latitude, longitude, scanned_at FROM qr_scans WHERE pack_id = ? ORDER BY id ASC LIMIT 2000').all(packId)
}

// Re-checks a jar. Once an officer has cleared an alert, the same alert only comes back on new evidence: a new
// impossible trip after the clearance, more far-apart places than were cleared, or another full set of phones.
async function recheck(pack) {
  const cleared = new Map()
  for (const row of await db.prepare("SELECT reason, detail_json, resolved_at FROM jar_alerts WHERE pack_id = ? AND status = 'CLEARED' ORDER BY id ASC").all(pack.pack_id)) {
    cleared.set(row.reason, { at: row.resolved_at, detail: (() => { try { return JSON.parse(row.detail_json) } catch { return {} } })() })
  }
  const findings = evaluate(await scansOf(pack.pack_id), { travelSince: cleared.get('IMPOSSIBLE_TRAVEL')?.at || '' })
  for (const finding of findings) {
    const before = cleared.get(finding.reason)?.detail
    if (before && finding.reason === 'MANY_PLACES' && finding.detail.places.length <= (before.places?.length || 0)) continue
    if (before && finding.reason === 'TOO_MANY_PHONES' && finding.detail.phones < (before.phones || 0) + LIMITS.maxPhones) continue
    await openAlert(pack, finding.reason, finding.detail)
  }
}

// Logs one consumer scan of a jar and re-checks the jar. Returns what the verify page shows the buyer.
export async function recordScan({ packId, deviceId, ip, location = {} }) {
  const id = String(packId || '').trim().slice(0, 80)
  if (!DEVICE_ID.test(String(deviceId || ''))) throw new GuardError('Missing device id')
  const pack = await packOwner(id)
  if (!pack) throw new GuardError('Pack not found', 404)

  const place = cleanLocation(location)
  await db.transaction(async () => {
    await lockNamed(`scan:${id}`)
    // The same phone reloading the page is one scan, not many.
    const recent = await db.prepare('SELECT id, latitude FROM qr_scans WHERE pack_id = ? AND device_id = ? AND scanned_at > ? ORDER BY id DESC LIMIT 1')
      .get(id, deviceId, new Date(Date.now() - LIMITS.dedupeMinutes * 60000).toISOString())
    if (recent) {
      // A reload that now comes with a location fills it in.
      if (place && recent.latitude === null) {
        await db.prepare('UPDATE qr_scans SET latitude = ?, longitude = ?, accuracy_m = ? WHERE id = ?').run(place.latitude, place.longitude, place.accuracyM, recent.id)
      }
    } else {
      await db.prepare('INSERT INTO qr_scans (pack_id, device_id, ip_hash, latitude, longitude, accuracy_m, scanned_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, deviceId, hashIp(ip), place?.latitude ?? null, place?.longitude ?? null, place?.accuracyM ?? null, now())
    }

    if (pack.status === 'ACTIVE') await recheck(pack)
  })()

  return await scanSummary(id, deviceId)
}

export async function reportJar({ packId, deviceId, reason }) {
  const id = String(packId || '').trim().slice(0, 80)
  if (!DEVICE_ID.test(String(deviceId || ''))) throw new GuardError('Missing device id')
  const pack = await packOwner(id)
  if (!pack) throw new GuardError('Pack not found', 404)
  const text = String(reason || '').replace(/\s+/g, ' ').trim().slice(0, 300)
  if (text.length < 5) throw new GuardError('Tell us what looks wrong (at least 5 characters)')

  const existing = await db.prepare("SELECT detail_json FROM jar_alerts WHERE pack_id = ? AND reason = 'CONSUMER_REPORT' AND status = 'OPEN'").get(id)
  const reports = (() => { try { return JSON.parse(existing?.detail_json || '{}').reports || [] } catch { return [] } })()
  if (!reports.some((item) => item.deviceId === deviceId)) reports.push({ deviceId, text, at: now() })
  await openAlert(pack, 'CONSUMER_REPORT', { reports: reports.slice(-10) }, 'CONSUMER')
  return await scanSummary(id, deviceId)
}

// What the verify page shows about a jar's scan history. `deviceId` lets it tell a buyer "you" apart from others.
export async function scanSummary(packId, deviceId = null) {
  const stats = await db.prepare(`
    SELECT COUNT(*) AS scans, COUNT(DISTINCT device_id) AS phones, MIN(scanned_at) AS first_at,
      COUNT(DISTINCT CASE WHEN device_id <> ? THEN device_id END) AS other_phones,
      MIN(CASE WHEN device_id = ? THEN scanned_at END) AS my_first
    FROM qr_scans WHERE pack_id = ?
  `).get(deviceId || '', deviceId || '', packId)
  const pack = await db.prepare('SELECT status FROM packs WHERE pack_id = ?').get(packId)
  const alerts = await db.prepare("SELECT reason, created_at FROM jar_alerts WHERE pack_id = ? AND status = 'OPEN' ORDER BY id").all(packId)

  return {
    scans: Number(stats?.scans || 0),
    phones: Number(stats?.phones || 0),
    otherPhones: Number(stats?.other_phones || 0),
    firstScannedAt: stats?.first_at || null,
    firstScannedByYou: Boolean(stats?.my_first && stats.my_first === stats.first_at),
    confirmedCopy: pack?.status === 'CLONED',
    alerts: alerts.map((alert) => ({ reason: alert.reason, label: RULES[alert.reason] || alert.reason, since: alert.created_at })),
  }
}

// ------------------------------------------------------------------ officer review
export async function alertRows(scope, status = 'OPEN') {
  const statusSql = status === 'ALL' ? '' : ' AND a.status = ?'
  const rows = await db.prepare(`
    SELECT a.*, o.legal_name AS org_name, o.organization_code AS org_code, o.state, o.region,
      pb.pack_batch_code, pb.product_name, b.batch_code, u.name AS resolved_by_name
    FROM jar_alerts a
    JOIN packs p ON p.pack_id = a.pack_id
    JOIN pack_batches pb ON pb.id = p.pack_batch_id
    JOIN batches b ON b.id = pb.batch_id
    JOIN organizations o ON o.id = b.org_id
    LEFT JOIN users u ON u.id = a.resolved_by
    WHERE 1 = 1 ${scope.sql}${statusSql}
    ORDER BY (a.status = 'OPEN') DESC, a.id DESC LIMIT 300
  `).all(...scope.params, ...(status === 'ALL' ? [] : [status]))

  const summaries = new Map()
  for (const row of rows) if (!summaries.has(row.pack_id)) summaries.set(row.pack_id, await scanSummary(row.pack_id))

  return rows.map((row) => ({
    id: row.id, packId: row.pack_id, reason: row.reason, label: RULES[row.reason] || row.reason, source: row.source, status: row.status,
    detail: (() => { try { return JSON.parse(row.detail_json) } catch { return {} } })(),
    createdAt: row.created_at, resolvedAt: row.resolved_at, resolvedBy: row.resolved_by_name, resolutionNote: row.resolution_note,
    org: { name: row.org_name, code: row.org_code, state: row.state, region: row.region },
    product: row.product_name, packBatchCode: row.pack_batch_code, batchCode: row.batch_code,
    scanStats: summaries.get(row.pack_id),
  }))
}

// CONFIRM: the code is known to be on fake jars, so every future scan of it is told not to trust the jar, and
// that is sealed on the chain. CLEAR: the scans had an innocent explanation (a gift carried across states...).
export async function decideJar({ packId, decision, note, officer, scope }) {
  const text = String(note || '').replace(/\s+/g, ' ').trim().slice(0, 300)
  if (!['CONFIRM', 'CLEAR'].includes(decision)) throw new GuardError('Choose CONFIRM or CLEAR')
  if (text.length < 5) throw new GuardError('Add a short note (at least 5 characters) explaining the decision')

  const open = (await alertRows(scope, 'OPEN')).filter((alert) => alert.packId === packId)
  if (!open.length) throw new GuardError('No open alert for this jar in your jurisdiction', 404)

  await db.transaction(async () => {
    await db.prepare(`UPDATE jar_alerts SET status = ?, resolved_by = ?, resolved_at = ?, resolution_note = ? WHERE pack_id = ? AND status = 'OPEN'`)
      .run(decision === 'CONFIRM' ? 'CONFIRMED' : 'CLEARED', officer.id, now(), text, packId)
    if (decision === 'CONFIRM') {
      await db.prepare("UPDATE packs SET status = 'CLONED' WHERE pack_id = ?").run(packId)
      await appendTraceabilityEvent({
        entityType: 'PACK', entityId: packId, eventType: 'PACK_FLAGGED_CLONED',
        payload: { packId, reasons: open.map((alert) => alert.reason), decidedByRole: officer.role, decidedByUserId: officer.id },
        createdBy: officer.id,
      })
      await sealPendingBlock()
    }
  })()

  return { packId, status: decision === 'CONFIRM' ? 'CONFIRMED' : 'CLEARED' }
}
