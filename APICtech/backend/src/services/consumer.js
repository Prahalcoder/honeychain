import db from '../database/database.js'
import { validateBlockchain } from './blockchain.js'
import { parseJson } from './batches.js'
import { verifySignature } from './signing.js'

// Public consumer verification record. It exposes only what a shopper needs to
// trust a jar: product, producer, verified lab result, officer approval,
// traceability history and supply-chain journey. No contact, tax, finance or
// private operational data.

const EVENT_LABELS = {
  HARVEST_RECORDED: 'Batch created at harvest',
  LAB_TEST_REQUESTED: 'Laboratory test requested',
  LAB_RESULT_SUBMITTED: 'Laboratory certificate submitted',
  LAB_RESULT_VERIFIED: 'Certificate verified and digitally signed by KVIC officer',
  LAB_RESULT_REJECTED: 'Certificate rejected by KVIC officer',
  PACK_BATCH_CREATED: 'Packaging batch created',
  PACK_CREATED: 'Jar registered and QR code generated',
  CUSTODY_TRANSFER: 'Custody transferred',
  DIRECT_SALE_REVERSED: 'Sale reversed, honey returned',
  LAB_DOCUMENT_ATTACHED: 'Scanned laboratory certificate attached',
  SHIPMENT_DELIVERED: 'Delivery to the buyer confirmed',
  DIRECT_SALE_RECORDED: 'Sold directly to a consumer',
  DIRECT_SALE_REVERSED: 'Direct sale reversed, jars returned',
}

const PARTY_LABELS = { APICTECH: 'Keeper', WHOLESALER: 'Distributor / wholesaler', RETAILER: 'Retailer' }
const ROLE_TITLES = { REGIONAL_OFFICER: 'Regional Officer', STATE_OFFICER: 'State Officer', KVIC_HEAD: 'KVIC Head' }

export async function getConsumerRecord(packId) {
  const pack = await db.prepare(`
    SELECT packs.pack_id, packs.status, packs.created_at,
      pack_batches.id AS pack_batch_id, pack_batches.pack_batch_code, pack_batches.product_name,
      pack_batches.jar_size_grams, batches.id AS batch_id, batches.batch_code, batches.honey_type,
      batches.harvest_date, batches.org_id
    FROM packs
    JOIN pack_batches ON pack_batches.id = packs.pack_batch_id
    JOIN batches ON batches.id = pack_batches.batch_id
    WHERE packs.pack_id = ?
  `).get(packId)

  if (!pack) return null

  return await buildRecord(pack, false)
}

// Lookup by batch number (no jar): same public information, batch level.
export async function getBatchConsumerRecord(batchCode) {
  const batch = await db.prepare('SELECT * FROM batches WHERE batch_code = ?').get(batchCode)
  if (!batch) return null

  const record = await buildRecord({
    pack_id: null,
    status: 'ACTIVE',
    created_at: null,
    pack_batch_id: null,
    pack_batch_code: null,
    product_name: null,
    jar_size_grams: null,
    batch_id: batch.id,
    batch_code: batch.batch_code,
    honey_type: batch.honey_type,
    harvest_date: batch.harvest_date,
    org_id: batch.org_id,
  }, true)

  record.scope = 'BATCH'
  record.product.bottles = (await db.prepare(`
    SELECT COUNT(*) AS count FROM packs p JOIN pack_batches pb ON pb.id = p.pack_batch_id WHERE pb.batch_id = ?
  `).get(batch.id)).count
  record.product.quantityKg = batch.quantity_kg

  return record
}

async function buildRecord(pack, batchLevel) {
  const producer = pack.org_id
    ? await db.prepare(`
        SELECT legal_name AS name, fssai_license AS fssaiLicense, state, region, status
        FROM organizations WHERE id = ?
      `).get(pack.org_id)
    : null

  const review = await db.prepare(`
    SELECT r.id, r.reviewed_at, r.signed_payload, r.signature, r.signing_key_id, r.signed_at,
      t.lab_name, t.certificate_reference, t.tested_at, t.status AS declared_status, t.results_json,
      u.name AS officer_name, u.role AS officer_role, u.state AS officer_state, u.region AS officer_region
    FROM lab_reviews r
    JOIN laboratory_tests t ON t.id = r.lab_test_id
    LEFT JOIN users u ON u.id = r.reviewed_by
    WHERE r.batch_id = ? AND r.status = 'VERIFIED' AND t.status = 'PASSED'
    ORDER BY r.id DESC LIMIT 1
  `).get(pack.batch_id)

  const signature = review ? await verifySignature({
    signedPayload: review.signed_payload,
    signature: review.signature,
    keyId: review.signing_key_id,
  }) : null

  const results = review ? parseJson(review.results_json) || {} : {}

  const ledger = await validateBlockchain()

  const events = (await db.prepare(`
    SELECT e.id, e.entity_type, e.event_type, e.payload_json, e.created_at, e.current_hash, b.height AS block_height
    FROM traceability_events e
    LEFT JOIN chain_blocks b ON e.id BETWEEN b.first_event_id AND b.last_event_id AND b.height > 0
    WHERE (e.entity_type = 'BATCH' AND e.entity_id = ?)
      OR (e.entity_type = 'PACK_BATCH' AND (e.entity_id = ? OR (? = 1 AND e.entity_id IN (
        SELECT pack_batch_code FROM pack_batches WHERE batch_id = ?))))
      OR (e.entity_type = 'PACK' AND e.entity_id = ?)
    ORDER BY e.id ASC
  `).all(pack.batch_code, pack.pack_batch_code, batchLevel ? 1 : 0, pack.batch_id, pack.pack_id))
    .filter((event) => batchLevel || !(event.event_type === 'CUSTODY_TRANSFER' && event.payload_json && JSON.parse(event.payload_json).metadata?.sale === 'LOOSE'))

  const timeline = events.map((event) => ({
    id: event.id,
    type: event.event_type,
    label: EVENT_LABELS[event.event_type] || event.event_type,
    at: event.created_at,
    blockHeight: event.block_height,
    hash: event.current_hash,
    scope: event.entity_type === 'PACK' ? 'THIS_JAR' : 'BATCH',
  }))

  const custody = await db.prepare(`
    SELECT from_party_type, from_party_id, to_party_type, to_party_id, quantity_kg, created_at
    FROM custody_events WHERE batch_id = ? AND (? = 1 OR COALESCE(metadata_json::json->>'sale', '') != 'LOOSE') ORDER BY id ASC
  `).all(pack.batch_id, batchLevel ? 1 : 0)

  const supplyChain = [
    { stage: 'KEEPER', label: PARTY_LABELS.APICTECH, name: producer?.name || 'Producer', at: pack.harvest_date },
    ...custody.map((move) => ({
      stage: move.to_party_type,
      label: PARTY_LABELS[move.to_party_type] || move.to_party_type,
      name: move.to_party_id,
      quantityKg: move.quantity_kg,
      at: move.created_at,
    })),
    { stage: 'CONSUMER', label: 'Consumer', name: 'You scanned this jar', at: null },
  ]

  // A producer that was formally closed stays verifiable: honey packed while it
  // was registered is still authentic. Suspended or rejected producers are not.
  const producerOk = !producer || ['APPROVED', 'CLOSURE_PENDING', 'CLOSED'].includes(producer.status)
  let authenticity = 'VALID'
  let reason = 'Laboratory-verified, officer-approved and recorded on the Honey Chain blockchain.'

  if (!ledger.valid || pack.status !== 'ACTIVE' || !producerOk) {
    authenticity = 'UNDER_REVIEW'
    reason = !ledger.valid
      ? 'The blockchain integrity check did not pass. Do not rely on this record.'
      : pack.status !== 'ACTIVE'
        ? 'This jar has been flagged by KVIC.'
        : 'The producer is currently not approved by KVIC.'
  } else if (!review || !signature?.valid) {
    authenticity = 'NOT_CERTIFIED'
    reason = review
      ? 'The officer signature on the laboratory certificate could not be verified.'
      : 'This jar has no KVIC-verified laboratory certificate on record.'
  }

  return {
    authenticity,
    reason,
    product: {
      name: pack.product_name,
      jarSizeGrams: pack.jar_size_grams,
      packId: pack.pack_id,
      packBatchCode: pack.pack_batch_code,
      batchCode: pack.batch_code,
      honeyType: pack.honey_type,
      harvestDate: pack.harvest_date,
      packedAt: pack.created_at,
    },
    producer: producer && {
      name: producer.name,
      fssaiLicense: producer.fssaiLicense,
      state: producer.state,
      region: producer.region,
      closed: producer.status === 'CLOSED',
    },
    laboratory: review && {
      labName: review.lab_name,
      certificateReference: review.certificate_reference,
      testedAt: review.tested_at,
      outcome: review.declared_status,
      results: {
        moisturePercent: results.moisturePercent ?? null,
        hmfMgPerKg: results.hmfMgPerKg ?? null,
        sucrosePercent: results.sucrosePercent ?? null,
        antibiotics: results.antibiotics ?? null,
      },
    },
    approval: review && {
      status: 'VERIFIED',
      officerName: review.officer_name,
      designation: [ROLE_TITLES[review.officer_role] || 'Officer', review.officer_region, review.officer_state].filter(Boolean).join(', '),
      signedAt: review.signed_at || review.reviewed_at,
      signatureValid: Boolean(signature?.valid),
      keyFingerprint: signature?.fingerprint || null,
    },
    timeline,
    supplyChain,
    ledger: {
      valid: ledger.valid,
      blocks: ledger.blocks ?? null,
      headHeight: ledger.headHeight ?? null,
      transactions: ledger.events ?? null,
    },
  }
}
