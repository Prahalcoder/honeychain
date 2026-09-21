import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import db from '../database/database.js'
import { DATA_DIR, VALIDATOR_KEY_FILE } from '../config/paths.js'
import { lockLedger } from './ledgerLock.js'
import { GENESIS_HASH, validateTraceabilityChain } from './traceabilityLog.js'

// Permissioned chain: traceability events are the transactions. Every business
// operation seals the events it produced into a block that carries a Merkle
// root, the previous block hash and an ed25519 signature from the validator
// node. Blocks are append-only (database triggers) and fully re-verifiable.

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')

let signer = null

async function loadSigner() {
  if (signer) return signer

  fs.mkdirSync(DATA_DIR, { recursive: true })

  let privateKey
  if (fs.existsSync(VALIDATOR_KEY_FILE)) {
    privateKey = crypto.createPrivateKey(fs.readFileSync(VALIDATOR_KEY_FILE))
  } else {
    privateKey = crypto.generateKeyPairSync('ed25519').privateKey
    fs.mkdirSync(path.dirname(VALIDATOR_KEY_FILE), { recursive: true })
    fs.writeFileSync(
      VALIDATOR_KEY_FILE,
      privateKey.export({ type: 'pkcs8', format: 'pem' }),
      { mode: 0o600 },
    )
  }

  const publicKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' })
  let validator = await db.prepare('SELECT id FROM chain_validators WHERE public_key = ?').get(publicKey)

  if (!validator) {
    const count = (await db.prepare('SELECT COUNT(*) AS count FROM chain_validators').get()).count
    const id = `validator-${count + 1}`
    await db.prepare('INSERT INTO chain_validators (id, public_key) VALUES (?, ?)').run(id, publicKey)
    validator = { id }
  }

  signer = { privateKey, validatorId: validator.id }
  return signer
}

export function merkleRoot(hashes) {
  if (hashes.length === 0) return sha256('')

  let level = hashes
  while (level.length > 1) {
    const next = []
    for (let index = 0; index < level.length; index += 2) {
      next.push(sha256(level[index] + (level[index + 1] ?? level[index])))
    }
    level = next
  }

  return level[0]
}

function hashBlock(block) {
  return sha256(JSON.stringify({
    height: block.height,
    prevHash: block.prev_hash,
    merkleRoot: block.merkle_root,
    firstEventId: block.first_event_id,
    lastEventId: block.last_event_id,
    txCount: block.tx_count,
    validatorId: block.validator_id,
    timestamp: block.timestamp,
  }))
}

const insertBlock = async (block) => await db.prepare(`
  INSERT INTO chain_blocks
  (height, prev_hash, merkle_root, first_event_id, last_event_id, tx_count, validator_id, timestamp, block_hash, signature)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(block.height, block.prev_hash, block.merkle_root, block.first_event_id, block.last_event_id, block.tx_count, block.validator_id, block.timestamp, block.block_hash, block.signature)

async function getHead() {
  return await db.prepare('SELECT * FROM chain_blocks ORDER BY height DESC LIMIT 1').get()
}

async function ensureGenesis() {
  if (await getHead()) return

  await db.transaction(async () => {
    await lockLedger()
    if (await getHead()) return
    await writeGenesis()
  })()
}

async function writeGenesis() {
  const { validatorId, privateKey } = await loadSigner()
  const block = {
    height: 0,
    prev_hash: GENESIS_HASH,
    merkle_root: merkleRoot([]),
    first_event_id: 0,
    last_event_id: 0,
    tx_count: 0,
    validator_id: validatorId,
    timestamp: new Date().toISOString(),
  }
  block.block_hash = hashBlock(block)
  block.signature = crypto.sign(null, Buffer.from(block.block_hash, 'hex'), privateKey).toString('base64')

  await insertBlock(block)
}

// Seals every event appended since the last block. Call it once at the end of
// each operation so related events (e.g. 100 bottle QR codes) share one block.
export async function sealPendingBlock() {
  await ensureGenesis()
  const { validatorId, privateKey } = await loadSigner()

  return await db.transaction(async () => {
    await lockLedger()
    const head = await getHead()
    const events = await db.prepare(`
      SELECT id, current_hash FROM traceability_events WHERE id > ? ORDER BY id ASC
    `).all(head.last_event_id)

    if (events.length === 0) return null

    const block = {
      height: head.height + 1,
      prev_hash: head.block_hash,
      merkle_root: merkleRoot(events.map((event) => event.current_hash)),
      first_event_id: events[0].id,
      last_event_id: events.at(-1).id,
      tx_count: events.length,
      validator_id: validatorId,
      timestamp: new Date().toISOString(),
    }
    block.block_hash = hashBlock(block)
    block.signature = crypto.sign(null, Buffer.from(block.block_hash, 'hex'), privateKey).toString('base64')

    await insertBlock(block)

    return block
  })()
}

export async function validateBlockchain() {
  await sealPendingBlock()

  const eventCheck = await validateTraceabilityChain()
  if (!eventCheck.valid) return { ...eventCheck, layer: 'EVENTS' }

  const blocks = await db.prepare('SELECT * FROM chain_blocks ORDER BY height ASC').all()
  const validators = new Map(
    (await db.prepare('SELECT id, public_key FROM chain_validators').all()).map((row) => [row.id, row.public_key]),
  )
  const eventsInRange = db.prepare(`
    SELECT id, current_hash FROM traceability_events
    WHERE id > ? AND id <= ? ORDER BY id ASC
  `)

  const broken = (reason, block) => ({ valid: false, layer: 'BLOCKS', reason, brokenAt: block.height })

  let previous = null
  for (const block of blocks) {
    if (block.height !== (previous ? previous.height + 1 : 0)) return broken('HEIGHT_GAP', block)

    if (block.prev_hash !== (previous ? previous.block_hash : GENESIS_HASH)) {
      return broken('PREVIOUS_BLOCK_HASH_MISMATCH', block)
    }

    const events = previous ? await eventsInRange.all(previous.last_event_id, block.last_event_id) : []

    if (events.length !== block.tx_count || (events[0]?.id ?? 0) !== block.first_event_id) {
      return broken('TRANSACTION_SET_MISMATCH', block)
    }

    if (merkleRoot(events.map((event) => event.current_hash)) !== block.merkle_root) {
      return broken('MERKLE_ROOT_MISMATCH', block)
    }

    if (hashBlock(block) !== block.block_hash) return broken('BLOCK_HASH_MISMATCH', block)

    const publicKey = validators.get(block.validator_id)
    const signatureOk = publicKey && crypto.verify(
      null,
      Buffer.from(block.block_hash, 'hex'),
      crypto.createPublicKey(publicKey),
      Buffer.from(block.signature, 'base64'),
    )

    if (!signatureOk) return broken('INVALID_VALIDATOR_SIGNATURE', block)

    previous = block
  }

  return {
    valid: true,
    layer: 'BLOCKS',
    events: eventCheck.events,
    blocks: blocks.length,
    headHeight: previous?.height ?? 0,
    headHash: previous?.block_hash ?? GENESIS_HASH,
    lastHash: eventCheck.lastHash,
    pendingEvents: 0,
  }
}

export async function getChainSummary() {
  await sealPendingBlock()
  const head = await getHead()
  const validator = await db.prepare('SELECT id, public_key FROM chain_validators WHERE id = ?').get(head.validator_id)
  const totals = await db.prepare('SELECT COUNT(*) AS events FROM traceability_events').get()

  return {
    height: head.height,
    headHash: head.block_hash,
    headTimestamp: head.timestamp,
    events: totals.events,
    validator: { id: validator.id, publicKey: validator.public_key },
    consensus: 'Proof of authority (single validator node)',
  }
}

function parseEvent(event) {
  return { ...event, payload: JSON.parse(event.payload_json), payload_json: undefined }
}

export async function listBlocks({ before, limit = 25 }) {
  const rows = await db.prepare(`
    SELECT height, prev_hash, merkle_root, tx_count, validator_id, timestamp, block_hash,
      first_event_id, last_event_id
    FROM chain_blocks
    WHERE height < ?
    ORDER BY height DESC
    LIMIT ?
  `).all(before ?? 2147483647, limit)

  return rows
}

export async function getBlock(height) {
  const block = await db.prepare('SELECT * FROM chain_blocks WHERE height = ?').get(height)
  if (!block) return null

  const events = block.height === 0
    ? []
    : (await db.prepare(`
        SELECT id, entity_type, entity_id, event_type, payload_json, created_by,
          prev_hash, current_hash, created_at
        FROM traceability_events
        WHERE id BETWEEN ? AND ?
        ORDER BY id ASC
        LIMIT 500
      `).all(block.first_event_id, block.last_event_id)).map(parseEvent)

  return { block, events }
}

export async function searchEvents({ entityType, entityId, orgId, limit = 100 }) {
  const conditions = []
  const params = []

  if (entityType) {
    conditions.push('e.entity_type = ?')
    params.push(entityType)
  }

  if (entityId) {
    conditions.push('e.entity_id = ?')
    params.push(entityId)
  }

  if (orgId) {
    conditions.push('eo.org_id = ?')
    params.push(orgId)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  return (await db.prepare(`
    SELECT e.id, e.entity_type, e.entity_id, e.event_type, e.payload_json, e.prev_hash,
      e.current_hash, e.created_at, b.height AS block_height
    FROM traceability_events e
    JOIN event_org eo ON eo.event_id = e.id
    LEFT JOIN chain_blocks b ON e.id BETWEEN b.first_event_id AND b.last_event_id AND b.height > 0
    ${where}
    ORDER BY e.id DESC
    LIMIT ?
  `).all(...params, limit)).map(parseEvent)
}
