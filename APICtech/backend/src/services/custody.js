import db from '../database/database.js'
import { sealPendingBlock } from './blockchain.js'
import { appendTraceabilityEvent } from './traceabilityLog.js'

export const PARTY_TYPES = new Set(['APICTECH', 'WHOLESALER', 'RETAILER'])

export class TransferError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

// Moves honey between parties on the supply chain and seals the event.
// APICTECH is the producer (keeper) party; WHOLESALER covers distributors.
export async function recordTransfer({
  batch,
  actorType,
  actorId,
  fromPartyType = 'APICTECH',
  fromPartyId = 'APICTECH',
  toPartyType,
  toPartyId,
  quantityKg,
  metadata = {},
  createdBy = null,
}) {
  if (!PARTY_TYPES.has(fromPartyType) || !PARTY_TYPES.has(toPartyType)) {
    throw new TransferError('Unsupported party type')
  }

  const quantity = Number(quantityKg)

  if (!String(toPartyId || '').trim() || !(quantity > 0)) {
    throw new TransferError('toPartyId and a positive quantityKg are required')
  }

  const sourceBalance = await db.prepare(`
    SELECT quantity_kg FROM custody_balances
    WHERE batch_id = ? AND party_type = ? AND party_id = ?
  `).get(batch.id, fromPartyType, fromPartyId)

  const available = sourceBalance?.quantity_kg
    ?? (fromPartyType === 'APICTECH' && fromPartyId === 'APICTECH' ? batch.quantity_kg : 0)

  if (quantity - available > 1e-9) {
    throw new TransferError('Transfer quantity exceeds current available quantity', 409)
  }

  return await db.transaction(async () => {
    const result = await db.prepare(`
      INSERT INTO custody_events
      (batch_id, event_type, actor_type, actor_id, from_party_type, from_party_id,
        to_party_type, to_party_id, quantity_kg, metadata_json, blockchain_tx_hash)
      VALUES (?, 'CUSTODY_TRANSFER', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      batch.id, actorType, String(actorId), fromPartyType, fromPartyId,
      toPartyType, String(toPartyId).trim(), quantity, JSON.stringify(metadata), `DATABASE_EVENT_${Date.now()}`,
    )

    const upsert = db.prepare(`
      INSERT INTO custody_balances (batch_id, party_type, party_id, quantity_kg)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(batch_id, party_type, party_id) DO UPDATE SET
        quantity_kg = custody_balances.quantity_kg + excluded.quantity_kg,
        updated_at = CURRENT_TIMESTAMP
    `)

    // Batches created before balances were tracked hold their full quantity implicitly.
    if (!sourceBalance) await upsert.run(batch.id, fromPartyType, fromPartyId, available)

    await upsert.run(batch.id, toPartyType, String(toPartyId).trim(), quantity)
    await upsert.run(batch.id, fromPartyType, fromPartyId, -quantity)

    await appendTraceabilityEvent({
      entityType: 'BATCH',
      entityId: batch.batch_code,
      eventType: 'CUSTODY_TRANSFER',
      payload: { fromPartyType, fromPartyId, toPartyType, toPartyId: String(toPartyId).trim(), quantityKg: quantity, metadata },
      createdBy,
    })
    await sealPendingBlock()

    await db.prepare('UPDATE batches SET status = ? WHERE id = ?').run('IN_TRANSIT', batch.id)

    return result.lastInsertRowid
  })()
}

