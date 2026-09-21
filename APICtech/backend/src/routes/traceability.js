import express from 'express'

import db from '../database/database.js'
import { authenticateToken, loadOrganization, requireRole } from '../middleware/auth.js'
import { authenticateCaptainApiKey } from '../middleware/apiKey.js'
import { getBatch, getBatchDetails, packagingStatus } from '../services/batches.js'
import { TransferError, recordTransfer } from '../services/custody.js'

const router = express.Router()

// Harvest batches are created through POST /api/company/harvests, lab work goes
// through /api/company/lab-requests, and keepers move honey with
// /api/company/transfers. This route is for the captain (distributor / retailer)
// app, which authenticates with an API key.
router.post('/batches/:batchCode/transfers', authenticateCaptainApiKey, async (req, res) => {
  const batch = await getBatch(req.params.batchCode)
  if (!batch) return res.status(404).json({ message: 'Batch not found' })

  const producer = batch.org_id
    ? await db.prepare('SELECT status FROM organizations WHERE id = ?').get(batch.org_id)
    : null

  if (producer && producer.status !== 'APPROVED') {
    return res.status(403).json({ message: 'The producing organisation is not approved for custody transfers' })
  }

  if (!(await packagingStatus(batch)).unlocked) {
    return res.status(403).json({ code: 'PACKAGING_LOCKED', message: 'This batch has no officer-verified laboratory certificate yet' })
  }

  try {
    const eventId = await recordTransfer({
      batch,
      actorType: req.apiClient.client_type,
      actorId: req.apiClient.id,
      fromPartyType: req.body.fromPartyType,
      fromPartyId: req.body.fromPartyId,
      toPartyType: req.body.toPartyType,
      toPartyId: req.body.toPartyId,
      quantityKg: req.body.quantityKg,
      metadata: req.body.metadata,
    })

    res.status(201).json({
      eventId,
      storage: { type: 'DATABASE', status: 'RECORDED' },
      traceability: await getBatchDetails(req.params.batchCode),
    })
  } catch (error) {
    if (error instanceof TransferError) return res.status(error.status).json({ message: error.message })
    throw error
  }
})

router.get(
  '/batches/:batchCode',
  authenticateToken,
  requireRole('BEEKEEPER'),
  loadOrganization,
  async (req, res) => {
    const batch = await getBatch(req.params.batchCode)

    if (!batch || batch.org_id !== req.org.id) {
      return res.status(404).json({ message: 'Batch not found' })
    }

    res.json(await getBatchDetails(req.params.batchCode))
  },
)

export const qrRouter = express.Router()

qrRouter.get('/:batchCode', async (req, res) => {
  const details = await getBatchDetails(req.params.batchCode)
  if (!details) return res.status(404).json({ message: 'Batch not found' })

  // Public: event types and block numbers only, no payloads or officer notes.
  res.json({
    verification: 'Honey Chain batch verification',
    ...details,
    chain: details.chain.map(({ payload, created_by, ...event }) => event),
    laboratory: details.laboratory.map(({ review_note, ...test }) => test),
  })
})

export default router
