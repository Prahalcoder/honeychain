import express from 'express'

import db from '../database/database.js'
import { authenticateToken, loadOrganization, requireApprovedOrg, requireRole } from '../middleware/auth.js'
import { sealPendingBlock, validateBlockchain } from '../services/blockchain.js'
import { batchCapacity, getBatch, maxBottlesFor, packagingStatus } from '../services/batches.js'
import { getBatchConsumerRecord, getConsumerRecord } from '../services/consumer.js'
import { nextCode } from '../services/codes.js'
import { onJarsCreated, proofFor } from '../services/chain.js'
import { appendTraceabilityEvent } from '../services/traceabilityLog.js'

import { lanAddress } from '../config/network.js'
import { lockNamed } from '../services/ledgerLock.js'

const router = express.Router()

class CapacityLost extends Error {
  constructor(maxBottles) {
    super('capacity lost')
    this.maxBottles = maxBottles
  }
}

const MIN_JAR_GRAMS = 10
const MAX_JAR_GRAMS = 25000

function publicVerificationUrl(packId) {
  // A phone can not open "localhost": without a configured address, use this computer's address on the Wi-Fi.
  const base = process.env.PUBLIC_VERIFY_PAGE_URL || `http://${lanAddress() || 'localhost'}:5175/verify`
  return `${base}?pack_id=${encodeURIComponent(packId)}`
}

const keeperOnly = [authenticateToken, requireRole('BEEKEEPER'), loadOrganization]

async function ownedPackBatch(req) {
  return await db.prepare(`
    SELECT pb.* FROM pack_batches pb
    JOIN batches b ON b.id = pb.batch_id
    WHERE pb.pack_batch_code = ? AND b.org_id = ?
  `).get(req.params.packBatchCode, req.org.id)
}

router.get('/pack-batches', ...keeperOnly, async (req, res) => {
  const rows = await db.prepare(`
    SELECT pb.pack_batch_code, pb.product_name, pb.jar_size_grams, pb.quantity_to_pack,
      pb.created_at, b.batch_code,
      (SELECT COUNT(*) FROM packs p WHERE p.pack_batch_id = pb.id) AS packs_created
    FROM pack_batches pb
    JOIN batches b ON b.id = pb.batch_id
    WHERE b.org_id = ?
    ORDER BY pb.id DESC
  `).all(req.org.id)

  res.json(rows)
})

router.post('/pack-batches', ...keeperOnly, requireApprovedOrg, async (req, res) => {
  const {
    batchCode,
    productName = 'Natural Honey',
    jarSizeGrams,
    quantityToPack,
  } = req.body

  const batch = await getBatch(batchCode)

  if (!batch || batch.org_id !== req.org.id) {
    return res.status(404).json({ message: 'Source batch not found in your organisation' })
  }

  // Packaging stays locked until the regional officer has verified the lab certificate.
  const packaging = await packagingStatus(batch)

  if (!packaging.unlocked) {
    return res.status(403).json({ code: 'PACKAGING_LOCKED', labStatus: packaging.labStatus, message: `Packaging is locked. ${packaging.reason}` })
  }

  const jarSize = Number(jarSizeGrams)
  const quantity = Number(quantityToPack)

  if (!Number.isInteger(jarSize) || jarSize < MIN_JAR_GRAMS || jarSize > MAX_JAR_GRAMS) {
    return res.status(400).json({ message: `Jar size must be a whole number between ${MIN_JAR_GRAMS} and ${MAX_JAR_GRAMS} grams` })
  }

  if (!Number.isInteger(quantity) || quantity < 1) {
    return res.status(400).json({ message: 'Number of bottles must be a whole number of at least 1' })
  }

  // Bottle QR codes can never outnumber the honey harvested in the batch.
  const capacity = await batchCapacity(batch)
  const maxBottles = maxBottlesFor(capacity, jarSize)

  if (quantity > maxBottles) {
    const detail = `${batch.batch_code} holds ${batch.quantity_kg} kg; ${capacity.packedBottles} bottle(s) `
      + `(${capacity.packedGrams} g) are already reserved.`

    return res.status(409).json({
      code: 'BOTTLE_LIMIT_EXCEEDED',
      message: maxBottles === 0
        ? `No honey is left in this batch for ${jarSize} g bottles. ${detail}`
        : `You can create at most ${maxBottles} QR code(s) of ${jarSize} g from what is left in this batch, `
          + `but ${quantity} were requested. ${detail}`,
      maxBottles,
      capacity,
    })
  }

  const packBatchCode = await nextCode('PB')

  let result
  try {
    result = await db.transaction(async () => {
    // Two requests at the same moment must not both take the last of the honey: check again under a lock.
    await lockNamed(`honey:${batch.id}`)
    const fresh = await batchCapacity(batch)
    if (quantity > maxBottlesFor(fresh, jarSize)) throw new CapacityLost(maxBottlesFor(fresh, jarSize))

    const inserted = await db.prepare(`
      INSERT INTO pack_batches
      (pack_batch_code, batch_id, product_name, jar_size_grams, quantity_to_pack)
      VALUES (?, ?, ?, ?, ?)
    `).run(packBatchCode, batch.id, String(productName).trim().slice(0, 60) || 'Natural Honey', jarSize, quantity)

    await appendTraceabilityEvent({
      entityType: 'PACK_BATCH',
      entityId: packBatchCode,
      eventType: 'PACK_BATCH_CREATED',
      payload: {
        batchCode: batch.batch_code,
        organizationCode: req.org.organization_code,
        productName,
        jarSizeGrams: jarSize,
        quantityToPack: quantity,
      },
      createdBy: req.user.id,
    })
    await sealPendingBlock()

    return inserted
    })()
  } catch (error) {
    if (error instanceof CapacityLost) {
      return res.status(409).json({ code: 'BOTTLE_LIMIT_EXCEEDED', message: `The honey of this batch was just used by another request. At most ${error.maxBottles} QR code(s) of ${jarSize} g are left.`, maxBottles: error.maxBottles })
    }
    throw error
  }

  res.status(201).json({
    id: result.lastInsertRowid,
    packBatchCode,
    sourceBatch: batch.batch_code,
    status: 'CREATED',
    capacity: await batchCapacity(batch),
  })
})

router.post('/pack-batches/:packBatchCode/packs', ...keeperOnly, requireApprovedOrg, async (req, res) => {
  const packBatch = await ownedPackBatch(req)

  if (!packBatch) return res.status(404).json({ message: 'Pack batch not found' })

  const requestedQuantity = Number(req.body.quantity || packBatch.quantity_to_pack)
  if (!Number.isInteger(requestedQuantity) || requestedQuantity < 1 || requestedQuantity > packBatch.quantity_to_pack) {
    return res.status(400).json({ message: 'quantity must be a valid number within the pack batch quantity' })
  }

  const packs = await db.transaction(async () => {
    const created = []
    for (let index = 0; index < requestedQuantity; index += 1) {
      const packId = `${packBatch.pack_batch_code}-JAR-${String(index + 1).padStart(6, '0')}`
      const insertResult = await db.prepare(`
        INSERT OR IGNORE INTO packs (pack_id, pack_batch_id)
        VALUES (?, ?)
      `).run(packId, packBatch.id)

      if (insertResult.changes === 0) {
        const existing = await db.prepare('SELECT status, created_at FROM packs WHERE pack_id = ?').get(packId)
        created.push({ packId, qrUrl: publicVerificationUrl(packId), ...existing })
        continue
      }

      await appendTraceabilityEvent({
        entityType: 'PACK',
        entityId: packId,
        eventType: 'PACK_CREATED',
        payload: { packId, packBatchCode: packBatch.pack_batch_code, sourceBatchId: packBatch.batch_id },
        createdBy: req.user.id,
      })

      created.push({ packId, qrUrl: publicVerificationUrl(packId) })
    }

    await sealPendingBlock()
    return created
  })()

  const created = (await db.prepare('SELECT COUNT(*) AS n FROM packs WHERE pack_batch_id = ?').get(packBatch.id)).n
  if (created === packBatch.quantity_to_pack) {
    const source = await db.prepare('SELECT batch_code FROM batches WHERE id = ?').get(packBatch.batch_id)
    await onJarsCreated({ userId: req.user.id, packBatchCode: packBatch.pack_batch_code, batchCode: source.batch_code })
  }

  res.status(201).json({ packBatchCode: packBatch.pack_batch_code, packs })
})

router.get('/pack-batches/:packBatchCode/packs', ...keeperOnly, async (req, res) => {
  const packBatch = await ownedPackBatch(req)
  if (!packBatch) return res.status(404).json({ message: 'Pack batch not found' })

  const packs = (await db.prepare(`
    SELECT packs.pack_id, packs.status, packs.created_at,
      pack_batches.pack_batch_code, pack_batches.product_name, pack_batches.jar_size_grams
    FROM packs
    JOIN pack_batches ON pack_batches.id = packs.pack_batch_id
    WHERE pack_batches.id = ?
    ORDER BY packs.id ASC
  `).all(packBatch.id)).map((pack) => ({
    ...pack,
    qrUrl: publicVerificationUrl(pack.pack_id),
  }))

  res.json(packs)
})

router.get('/traceability/validate', authenticateToken, async (req, res) => {
  res.json(await validateBlockchain())
})

export const verificationRouter = express.Router()

// Public endpoint behind every bottle QR code and the consumer verification page.
verificationRouter.get('/', async (req, res) => {
  const batch = String(req.query.batch || '').trim()
  const record = batch
    ? await getBatchConsumerRecord(batch)
    : await getConsumerRecord(String(req.query.pack_id || '').trim())

  if (!record) return res.status(404).json({ message: batch ? 'Batch not found' : 'Pack not found' })
  res.json(record)
})

export default router

// Live check against the smart contract for the public verification page.
verificationRouter.get('/onchain', async (req, res) => {
  const packId = String(req.query.pack_id || '').trim()
  const batchCode = String(req.query.batch || '').trim()

  if (packId) {
    const jar = await db.prepare(`
      SELECT p.pack_id, pb.pack_batch_code, b.batch_code FROM packs p
      JOIN pack_batches pb ON pb.id = p.pack_batch_id JOIN batches b ON b.id = pb.batch_id WHERE p.pack_id = ?
    `).get(packId)
    if (!jar) return res.status(404).json({ message: 'Pack not found' })
    return res.json(await proofFor({ batchCode: jar.batch_code, packBatchCode: jar.pack_batch_code, packId: jar.pack_id }))
  }

  if (!batchCode || !await db.prepare('SELECT 1 FROM batches WHERE batch_code = ?').get(batchCode)) return res.status(404).json({ message: 'Batch not found' })
  return res.json(await proofFor({ batchCode }))
})
