import db from '../database/database.js'
import { appendTraceabilityEvent, getTraceabilityEvents } from './traceabilityLog.js'
import { validateBlockchain, sealPendingBlock } from './blockchain.js'
import { lockNamed } from './ledgerLock.js'

export function parseJson(value) {
  if (!value) return null

  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export async function getBatch(batchCode) {
  return await db.prepare('SELECT * FROM batches WHERE batch_code = ?').get(batchCode)
}

export async function nextBatchCode() {
  const prefix = `HC-${new Date().getFullYear()}-`
  const highest = (await db
    .prepare('SELECT batch_code FROM batches WHERE batch_code LIKE ?')
    .all(`${prefix}%`))
    .reduce((max, row) => Math.max(max, Number(row.batch_code.slice(prefix.length)) || 0), 0)

  return `${prefix}${String(highest + 1).padStart(4, '0')}`
}

// Bottle capacity of a batch. A jar is only allowed if honey is left for it,
// counting every jar already reserved by earlier packaging batches.
export async function batchCapacity(batch) {
  const totalGrams = Math.round(batch.quantity_kg * 1000)
  const used = await db.prepare(`
    SELECT COALESCE(SUM(jar_size_grams * quantity_to_pack), 0) AS grams,
      COALESCE(SUM(quantity_to_pack), 0) AS bottles
    FROM pack_batches
    WHERE batch_id = ?
  `).get(batch.id)

  const looseGrams = await looseSoldGrams(batch.id)

  return {
    totalGrams,
    packedGrams: used.grams,
    packedBottles: used.bottles,
    looseGrams,
    remainingGrams: Math.max(0, totalGrams - used.grams - looseGrams),
  }
}

// Honey from this batch that was sold loose to wholesalers (and not taken back).
export async function looseSoldGrams(batchId) {
  return (await db.prepare("SELECT COALESCE(SUM(grams), 0) AS grams FROM loose_sales WHERE batch_id = ? AND status = 'ACTIVE'").get(batchId)).grams
}

// Packaging (and downstream custody) stays locked until a regional officer has
// verified a laboratory certificate that says the batch passed.
export async function packagingStatus(batch) {
  const reviews = await db.prepare(`
    SELECT r.status AS review_status, t.status AS declared_status
    FROM lab_reviews r JOIN laboratory_tests t ON t.id = r.lab_test_id
    WHERE r.batch_id = ? ORDER BY r.id DESC
  `).all(batch.id)

  if (reviews.some((row) => row.review_status === 'VERIFIED' && row.declared_status === 'PASSED')) {
    return { unlocked: true, labStatus: 'VERIFIED', reason: null }
  }

  const latest = reviews[0]
  const request = await db.prepare('SELECT status FROM lab_requests WHERE batch_id = ? ORDER BY id DESC LIMIT 1').get(batch.id)

  if (!latest && !request) {
    return { unlocked: false, labStatus: 'NOT_REQUESTED', reason: 'No laboratory test has been requested for this batch yet.' }
  }

  if (!latest) {
    return { unlocked: false, labStatus: 'REQUESTED', reason: 'A lab test was requested. Submit the laboratory certificate for officer review.' }
  }

  if (latest.review_status === 'PENDING') {
    return { unlocked: false, labStatus: 'PENDING_REVIEW', reason: 'Waiting for your regional officer to verify the laboratory certificate.' }
  }

  if (latest.review_status === 'REJECTED') {
    return { unlocked: false, labStatus: 'REJECTED', reason: 'The regional officer rejected the certificate. Request a new lab test and submit the corrected certificate.' }
  }

  return { unlocked: false, labStatus: 'FAILED', reason: 'The verified certificate shows this batch failed testing, so it cannot be packaged.' }
}

export function maxBottlesFor(capacity, jarSizeGrams) {
  return Math.floor(capacity.remainingGrams / jarSizeGrams)
}

// Creates the harvest batch on the shared chain. The company's own harvest
// record (with notes and location) is written to its private database by the caller.
export async function createChainBatch({ organization, userId, hiveCode, quantityKg, honeyType, harvestDate }) {
  let batchCode = null

  await db.transaction(async () => {
    await lockNamed('batch-code')
    batchCode = await nextBatchCode()

    const result = await db.prepare(`
      INSERT INTO batches
      (batch_code, hive_code, quantity_kg, honey_type, harvest_date, status, org_id)
      VALUES (?, ?, ?, ?, ?, 'HARVESTED', ?)
    `).run(batchCode, hiveCode, quantityKg, honeyType, harvestDate, organization.id)

    await db.prepare(`
      INSERT INTO custody_balances (batch_id, party_type, party_id, quantity_kg)
      VALUES (?, 'APICTECH', 'APICTECH', ?)
    `).run(result.lastInsertRowid, quantityKg)

    await appendTraceabilityEvent({
      entityType: 'BATCH',
      entityId: batchCode,
      eventType: 'HARVEST_RECORDED',
      payload: {
        batchCode,
        organizationCode: organization.organization_code,
        hiveCode,
        quantityKg,
        honeyType,
        harvestDate,
      },
      createdBy: userId,
    })

    await sealPendingBlock()
  })()

  return batchCode
}

const LAB_STATUS_LABELS = { PENDING: 'PENDING_REVIEW', VERIFIED: 'VERIFIED', REJECTED: 'REJECTED' }

export async function getBatchDetails(batchCode) {
  const batch = await getBatch(batchCode)
  if (!batch) return null

  const labTests = (await db
    .prepare(`
      SELECT t.id, t.lab_name, t.status, t.certificate_reference, t.results_json,
        t.tested_at, t.created_at, r.status AS review_status, r.review_note, r.reviewed_at
      FROM laboratory_tests t
      LEFT JOIN lab_reviews r ON r.lab_test_id = t.id
      WHERE t.batch_id = ?
      ORDER BY t.created_at DESC, t.id DESC
    `)
    .all(batch.id))
    .map((test) => ({
      ...test,
      results: parseJson(test.results_json),
      results_json: undefined,
    }))

  const events = (await db
    .prepare(`
      SELECT id, event_type, actor_type, actor_id,
        from_party_type, from_party_id, to_party_type, to_party_id,
        quantity_kg, metadata_json, blockchain_tx_hash AS record_reference, created_at
      FROM custody_events
      WHERE batch_id = ?
      ORDER BY id ASC
    `)
    .all(batch.id))
    .map((event) => ({
      ...event,
      metadata: parseJson(event.metadata_json),
      metadata_json: undefined,
    }))

  const latestEvent = events.at(-1) || null
  const latestLabTest = labTests[0] || null
  const holders = await db
    .prepare(`
      SELECT party_type, party_id, quantity_kg, updated_at
      FROM custody_balances
      WHERE batch_id = ? AND quantity_kg > 0
      ORDER BY quantity_kg DESC
    `)
    .all(batch.id)
  const visibleHolders = holders.length > 0
    ? holders
    : [{ party_type: 'APICTECH', party_id: 'APICTECH', quantity_kg: batch.quantity_kg }]

  const producer = batch.org_id
    ? await db.prepare(`
        SELECT legal_name AS name, fssai_license AS fssaiLicense, state, region, status
        FROM organizations WHERE id = ?
      `).get(batch.org_id)
    : null

  return {
    batch: {
      ...batch,
      lab_status: latestLabTest
        ? LAB_STATUS_LABELS[latestLabTest.review_status] || 'NOT_SUBMITTED'
        : 'NOT_SUBMITTED',
      current_holder_type: visibleHolders.length === 1 ? visibleHolders[0].party_type : 'MULTIPLE',
      current_holder_id: visibleHolders.length === 1 ? visibleHolders[0].party_id : null,
      holders: visibleHolders,
    },
    producer,
    laboratory: labTests,
    custody: events,
    chain: await getTraceabilityEvents('BATCH', batch.batch_code),
    ledger: await validateBlockchain(),
    qr: {
      version: latestEvent?.id || 0,
      stableUrl: `${process.env.PUBLIC_VERIFICATION_URL || '/api/qr'}/${encodeURIComponent(batch.batch_code)}`,
      refreshedAt: new Date().toISOString(),
    },
  }
}
