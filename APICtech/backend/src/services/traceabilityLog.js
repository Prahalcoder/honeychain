import crypto from 'node:crypto'

import db from '../database/database.js'
import { lockLedger } from './ledgerLock.js'

export const GENESIS_HASH = '0'.repeat(64)

// Appends one hash-chained event. The event becomes part of the shared
// blockchain once sealPendingBlock() (services/blockchain.js) runs.
export async function appendTraceabilityEvent({
  entityType,
  entityId,
  eventType,
  payload,
  createdBy = null,
}) {
  // The next hash depends on the last one, so two writers must never read the same last event.
  return await db.transaction(async () => {
    await lockLedger()
    const previous = await db.prepare(`
      SELECT current_hash
      FROM traceability_events
      ORDER BY id DESC
      LIMIT 1
    `).get()

    const prevHash = previous?.current_hash || GENESIS_HASH
    const createdAt = new Date().toISOString()
    const payloadJson = JSON.stringify(payload)
    const currentHash = crypto.createHash('sha256').update(JSON.stringify({
      entityType,
      entityId,
      eventType,
      payloadJson,
      createdBy,
      prevHash,
      createdAt,
    })).digest('hex')

    return await db.prepare(`
      INSERT INTO traceability_events
      (entity_type, entity_id, event_type, payload_json, created_by, prev_hash, current_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entityType,
      entityId,
      eventType,
      payloadJson,
      createdBy,
      prevHash,
      currentHash,
      createdAt,
    )
  })()
}

export async function getTraceabilityEvents(entityType, entityId) {
  return (await db.prepare(`
    SELECT e.id, e.entity_type, e.entity_id, e.event_type, e.payload_json,
      e.created_by, e.prev_hash, e.current_hash, e.created_at, b.height AS block_height
    FROM traceability_events e
    LEFT JOIN chain_blocks b
      ON e.id BETWEEN b.first_event_id AND b.last_event_id AND b.height > 0
    WHERE e.entity_type = ? AND e.entity_id = ?
    ORDER BY e.id ASC
  `).all(entityType, entityId)).map((event) => ({
    ...event,
    payload: JSON.parse(event.payload_json),
    payload_json: undefined,
  }))
}

// Event-level check: every event links to the one before it and its own hash
// recomputes. Block-level checks live in validateBlockchain().
export async function validateTraceabilityChain() {
  const events = await db.prepare(`
    SELECT id, entity_type, entity_id, event_type, payload_json,
      created_by, prev_hash, current_hash, created_at
    FROM traceability_events
    ORDER BY id ASC
  `).all()

  let expectedPrevious = GENESIS_HASH
  for (const event of events) {
    if (event.prev_hash !== expectedPrevious) {
      return {
        valid: false,
        reason: 'PREVIOUS_HASH_MISMATCH',
        brokenAt: event.id,
      }
    }

    const expectedCurrent = crypto.createHash('sha256').update(JSON.stringify({
      entityType: event.entity_type,
      entityId: event.entity_id,
      eventType: event.event_type,
      payloadJson: event.payload_json,
      createdBy: event.created_by,
      prevHash: event.prev_hash,
      createdAt: event.created_at,
    })).digest('hex')

    if (event.current_hash !== expectedCurrent) {
      return {
        valid: false,
        reason: 'CURRENT_HASH_MISMATCH',
        brokenAt: event.id,
      }
    }

    expectedPrevious = event.current_hash
  }

  return {
    valid: true,
    events: events.length,
    lastHash: events.at(-1)?.current_hash || GENESIS_HASH,
  }
}
