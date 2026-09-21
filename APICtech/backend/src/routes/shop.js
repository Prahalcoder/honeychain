import express from 'express'
import rateLimit from 'express-rate-limit'

import { ShopError, browseSellers, browseStates, cancelByBuyer, claimPayment, placeOrder, sellerDetail, trackOrder } from '../services/shop.js'

// Public shop API: no account. Buyers identify an order with its code and their phone number.
const router = express.Router()

const orderLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: Number(process.env.ORDER_RATE_LIMIT || 40), standardHeaders: 'draft-7', legacyHeaders: false, message: { message: 'Too many orders from this address. Please try again later.' } })
const lookupLimit = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false, message: { message: 'Too many requests. Please wait a little.' } })

const fail = (error, res) => {
  if (error instanceof ShopError) return res.status(error.status).json({ message: error.message })
  console.error(error)
  return res.status(500).json({ message: 'Something went wrong on the server' })
}

router.get('/states', lookupLimit, async (req, res) => {
  try { res.json(await browseStates()) } catch (error) { fail(error, res) }
})

router.get('/sellers', lookupLimit, async (req, res) => {
  try { res.json(await browseSellers({ state: String(req.query.state || ''), region: String(req.query.region || '') })) } catch (error) { fail(error, res) }
})

router.get('/sellers/:code', lookupLimit, async (req, res) => {
  try {
    const seller = await sellerDetail(req.params.code)
    if (!seller) return res.status(404).json({ message: 'Seller not found' })
    res.json(seller)
  } catch (error) { fail(error, res) }
})

router.post('/orders', orderLimit, async (req, res) => {
  try {
    const code = await placeOrder(req.body || {})
    res.status(201).json({ code, order: await trackOrder(code, req.body.buyerPhone) })
  } catch (error) { fail(error, res) }
})

// Tracking needs the phone number that was used for the order.
router.get('/orders/:code', lookupLimit, async (req, res) => {
  try { res.json(await trackOrder(req.params.code, String(req.query.phone || ''))) } catch (error) { fail(error, res) }
})

router.post('/orders/:code/paid', lookupLimit, async (req, res) => {
  try { res.json(await claimPayment(req.params.code, String(req.body?.phone || ''), req.body?.reference)) } catch (error) { fail(error, res) }
})

router.post('/orders/:code/cancel', lookupLimit, async (req, res) => {
  try { res.json(await cancelByBuyer(req.params.code, String(req.body?.phone || ''))) } catch (error) { fail(error, res) }
})

export default router
