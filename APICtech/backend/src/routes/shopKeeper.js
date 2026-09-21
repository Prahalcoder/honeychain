import express from 'express'

import { ShopError, cancelBySeller, createListing, markDelivered, markShipped, sellerOrderView, sellerOrders, sellerProducts, setPayment, updateListing } from '../services/shop.js'
import { getCompanyDb } from '../services/companyDb.js'

// The keeper's side of the shop: products for sale and the orders that come in. Mounted under /api/company/shop,
// so the keeper's login and approved organisation are already checked (req.org).
const router = express.Router()

const fail = (error, res) => {
  if (error instanceof ShopError) return res.status(error.status).json({ message: error.message })
  console.error(error)
  return res.status(500).json({ message: 'Something went wrong on the server' })
}

const privateDb = async (req) => await getCompanyDb(req.org.organization_code)

router.get('/products', async (req, res) => {
  try { res.json(await sellerProducts(req.org)) } catch (error) { fail(error, res) }
})

router.post('/products', async (req, res) => {
  try {
    await createListing(req.org, req.body || {})
    res.status(201).json(await sellerProducts(req.org))
  } catch (error) { fail(error, res) }
})

router.put('/products/:id', async (req, res) => {
  try {
    await updateListing(req.org, req.params.id, req.body || {})
    res.json(await sellerProducts(req.org))
  } catch (error) { fail(error, res) }
})

router.get('/orders', async (req, res) => {
  try { res.json(await sellerOrders(await privateDb(req))) } catch (error) { fail(error, res) }
})

router.patch('/orders/:code/payment', async (req, res) => {
  try { res.json(sellerOrderView(await setPayment(req.org, await privateDb(req), req.params.code, req.body?.status === 'PAID'))) } catch (error) { fail(error, res) }
})

router.patch('/orders/:code/ship', async (req, res) => {
  try { res.json(sellerOrderView(await markShipped(req.org, await privateDb(req), req.params.code, req.body || {}))) } catch (error) { fail(error, res) }
})

router.patch('/orders/:code/deliver', async (req, res) => {
  try { res.json(sellerOrderView(await markDelivered(req.org, await privateDb(req), req.params.code))) } catch (error) { fail(error, res) }
})

router.patch('/orders/:code/cancel', async (req, res) => {
  try { res.json(sellerOrderView(await cancelBySeller(req.org, await privateDb(req), req.params.code, req.body?.reason))) } catch (error) { fail(error, res) }
})

export default router
