import crypto from 'node:crypto'

import db from '../database/database.js'
import { getCompanyDb } from './companyDb.js'
import { indianMobile, maskMobile, sendSms, smsProvider } from './sms.js'

// Hive-health alerts by SMS, without a GSM module on the hive: the hive monitor (beehive/python_app/alerts.py)
// runs the hive-health analysis on the sensor readings and, when it finds a problem, reports it here with its
// monitor token. This service decides what is worth a text message, sends it to the keeper's mobile through the
// SMS API (services/sms.js), and keeps a record that the keeper sees in the app.
//
// Worth a text: every HIGH risk, and the MEDIUM ones too when the hive's overall status is AT_RISK. The same
// problem on the same hive is texted at most once per HIVE_ALERT_COOLDOWN_HOURS (default 6), so a hive that
// stays too cold does not send a message every minute.
export class AlertError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

const LEVELS = ['HIGH', 'MEDIUM', 'LOW']
const STATUSES = ['HEALTHY', 'WATCH', 'AT_RISK', 'NO_DATA']
const COOLDOWN_HOURS = Number(process.env.HIVE_ALERT_COOLDOWN_HOURS || 6)
const hash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex')
const text = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const now = () => new Date().toISOString()

async function ownerContact(org) {
  const row = await db.prepare(`
    SELECT u.name, s.phone, COALESCE(s.sms_alerts, 1) AS sms_alerts
    FROM users u LEFT JOIN user_settings s ON s.user_id = u.id WHERE u.id = ?
  `).get(org.owner_user_id)
  return { name: row?.name || '', mobile: indianMobile(row?.phone), smsOn: Number(row?.sms_alerts ?? 1) === 1 }
}

async function hiveOf(org, hiveCode) {
  return await (await getCompanyDb(org.organization_code)).prepare('SELECT hive_code, name, location FROM hives WHERE hive_code = ?').get(hiveCode)
}

// Links the hive monitor to one of the keeper's hives. Returns the token the monitor keeps (shown only once);
// linking the same hive again replaces the old token.
export async function linkMonitor(org, user, hiveCode) {
  const code = text(hiveCode, 20).toUpperCase()
  if (!(await hiveOf(org, code))) throw new AlertError('Hive not found', 404)
  const token = `hcm_${crypto.randomBytes(32).toString('base64url')}`
  await db.transaction(async () => {
    await db.prepare('UPDATE monitor_links SET revoked_at = ? WHERE org_id = ? AND hive_code = ? AND revoked_at IS NULL').run(now(), org.id, code)
    await db.prepare('INSERT INTO monitor_links (org_id, hive_code, token_hash, created_by, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(org.id, code, hash(token), user.id, now())
  })()
  return { token, hiveCode: code }
}

export async function unlinkMonitor(org, hiveCode) {
  await db.prepare('UPDATE monitor_links SET revoked_at = ? WHERE org_id = ? AND hive_code = ? AND revoked_at IS NULL').run(now(), org.id, text(hiveCode, 20).toUpperCase())
}

function smsText(hive, org, status, score, risks) {
  const head = `Honey Chain alert: hive ${hive.hive_code}${hive.name ? ` (${hive.name})` : ''}, ${org.legal_name}.`
  const state = status === 'AT_RISK' ? ` AT RISK, health ${score}/100.` : score !== null ? ` Health ${score}/100.` : ''
  const list = risks.map((risk) => `${risk.name} (${risk.level})`).join('; ')
  const action = risks[0]?.action ? ` Do now: ${risks[0].action}` : ''
  return text(`${head}${state} ${list}.${action} Details: Honey Chain Keeper > My Hives.`, 480)
}

// A report from a hive monitor. `payload`: { status, score, risks: [{ name, level, reason, action }] }.
export async function receiveReport(token, payload = {}) {
  if (!token) throw new AlertError('Missing monitor token', 401)
  const link = await db.prepare('SELECT * FROM monitor_links WHERE token_hash = ? AND revoked_at IS NULL').get(hash(token))
  if (!link) throw new AlertError('This monitor is not linked to a hive (or the link was replaced). Link it again from the Keeper app.', 401)
  const org = await db.prepare('SELECT * FROM organizations WHERE id = ?').get(link.org_id)
  if (!org || org.status !== 'APPROVED') throw new AlertError('The organisation is not active', 403)
  const hive = await hiveOf(org, link.hive_code)
  if (!hive) throw new AlertError('The linked hive no longer exists', 404)
  await db.prepare('UPDATE monitor_links SET last_seen_at = ? WHERE id = ?').run(now(), link.id)

  const status = STATUSES.includes(payload.status) ? payload.status : 'WATCH'
  const score = Number.isFinite(Number(payload.score)) ? Math.max(0, Math.min(100, Math.round(Number(payload.score)))) : null
  const risks = (Array.isArray(payload.risks) ? payload.risks : []).slice(0, 12)
    .map((risk) => ({ name: text(risk?.name, 80), level: String(risk?.level || '').toUpperCase(), reason: text(risk?.reason, 300), action: text(risk?.action, 200) }))
    .filter((risk) => risk.name && LEVELS.includes(risk.level))

  const worth = risks.filter((risk) => risk.level === 'HIGH' || (status === 'AT_RISK' && risk.level === 'MEDIUM'))
  if (worth.length === 0) return { alerted: 0, sms: 'NOT_NEEDED' }

  // Problems already texted within the cooldown are recorded but not texted again.
  const since = new Date(Date.now() - COOLDOWN_HOURS * 3600000).toISOString()
  const fresh = []
  const repeated = []
  for (const risk of worth) {
    const recent = await db.prepare(`
      SELECT 1 FROM hive_alerts WHERE org_id = ? AND hive_code = ? AND risk_name = ? AND created_at > ? AND sms_status IN ('SENT', 'DRY_RUN')
    `).get(org.id, hive.hive_code, risk.name, since)
    ;(recent ? repeated : fresh).push(risk)
  }

  let result = { status: 'COOLDOWN', ref: null, error: null }
  let message = null
  const contact = await ownerContact(org)
  if (fresh.length) {
    message = smsText(hive, org, status, score, fresh)
    if (!contact.smsOn) result = { status: 'SKIPPED', ref: null, error: 'SMS alerts are turned off' }
    else if (!contact.mobile) result = { status: 'SKIPPED', ref: null, error: 'No mobile number in Settings' }
    else result = await sendSms(contact.mobile, message)
  }

  const created = now()
  for (const risk of worth) {
    const isFresh = fresh.includes(risk)
    await db.prepare(`
      INSERT INTO hive_alerts (org_id, hive_code, risk_name, level, hive_status, score, reason, action, sms_status, sms_to, sms_text, sms_error, provider_ref, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(org.id, hive.hive_code, risk.name, risk.level, status, score, risk.reason, risk.action,
      isFresh ? result.status : 'COOLDOWN', isFresh && contact.mobile ? maskMobile(contact.mobile) : null,
      isFresh ? message : null, isFresh ? result.error : null, isFresh ? result.ref : null, created)
  }

  return { alerted: worth.length, texted: fresh.length, repeated: repeated.length, sms: fresh.length ? result.status : 'COOLDOWN' }
}

// What the keeper's app shows: recent alerts, the SMS set-up, and whether each hive has a monitor linked.
export async function alertOverview(org) {
  const alerts = await db.prepare(`
    SELECT id, hive_code AS "hiveCode", risk_name AS "riskName", level, hive_status AS "hiveStatus", score, reason, action,
      sms_status AS "smsStatus", sms_to AS "smsTo", sms_error AS "smsError", created_at AS "createdAt"
    FROM hive_alerts WHERE org_id = ? ORDER BY id DESC LIMIT 50
  `).all(org.id)
  const links = await db.prepare(`
    SELECT hive_code AS "hiveCode", created_at AS "linkedAt", last_seen_at AS "lastSeenAt" FROM monitor_links WHERE org_id = ? AND revoked_at IS NULL
  `).all(org.id)
  const contact = await ownerContact(org)
  return {
    alerts,
    links,
    sms: { enabled: contact.smsOn, to: maskMobile(contact.mobile), hasMobile: Boolean(contact.mobile), provider: smsProvider() || 'none (dry run)', cooldownHours: COOLDOWN_HOURS },
  }
}

export async function setSmsAlerts(org, enabled) {
  await db.prepare('UPDATE user_settings SET sms_alerts = ? WHERE user_id = ?').run(enabled ? 1 : 0, org.owner_user_id)
}

// "Send a test SMS" in the app, so the keeper knows the number and the provider work before a real alert.
export async function sendTestSms(org) {
  const contact = await ownerContact(org)
  if (!contact.mobile) throw new AlertError('Add your 10-digit mobile number in Settings first')
  const result = await sendSms(contact.mobile, `Honey Chain: test message for ${org.legal_name}. Hive health alerts will reach this number.`)
  if (result.status === 'FAILED') throw new AlertError(`The SMS could not be sent: ${result.error}`, 502)
  return { status: result.status, to: maskMobile(contact.mobile) }
}
