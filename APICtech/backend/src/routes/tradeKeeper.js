import express from 'express'

import { TradeError, acceptRequest, declineRequest, keeperRequests } from '../services/trade.js'
import { ReceiptError, attachReceipt, keeperReceipts } from '../services/wholesaleReceipts.js'

// A beekeeper's inbox of offers from KVIC-approved wholesalers. Mounted under /api/company/trade-requests, so the
// keeper's login and approved organisation are already checked (req.org).
const router = express.Router()

const fail = (error, res) => {
  if (error instanceof TradeError) return res.status(error.status).json({ message: error.message })
  throw error
}

// Receipts a wholesaler recorded and this keeper confirmed by OTP. One waiting for its harvest is attached to a
// batch here once the harvest is recorded.
router.get('/receipts', async (req, res) => {
  res.json(await keeperReceipts(req.org.id))
})

router.post('/receipts/:code/attach', async (req, res) => {
  try {
    res.json(await attachReceipt(req.org, req.user, req.params.code, req.body?.batchCode))
  } catch (error) {
    if (error instanceof ReceiptError) return res.status(error.status).json({ message: error.message })
    throw error
  }
})

router.get('/', async (req, res) => {
  res.json(await keeperRequests(req.org.id))
})

router.post('/:code/accept', async (req, res) => {
  try {
    res.json(await acceptRequest(req.org, req.user, req.params.code, {
      gstPercent: Number(req.body?.gstPercent || 0), paid: req.body?.paid === true, note: req.body?.note,
    }))
  } catch (error) { fail(error, res) }
})

router.post('/:code/decline', async (req, res) => {
  try {
    await declineRequest(req.org, req.params.code, req.body?.reason)
    res.json({ status: 'DECLINED' })
  } catch (error) { fail(error, res) }
})

export default router
