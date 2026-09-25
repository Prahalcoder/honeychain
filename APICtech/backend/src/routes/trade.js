import express from 'express'

import db from '../database/database.js'
import { authenticateToken, loadOrganization, requireApprovedOrg, requireRole } from '../middleware/auth.js'
import { TradeError, cancelRequest, createRequest, marketListings, traderRequests } from '../services/trade.js'
import { getProfile } from '../services/profiles.js'
import { missingRequiredDocuments } from '../services/orgDocuments.js'
import { officesForOrganization } from '../services/offices.js'
import { REGIONS } from '../config/regions.js'
import { ALL_HONEY_TYPES } from '../config/honeyCatalogue.js'
import { ReceiptError, cancelReceipt, confirmReceipt, resendReceiptOtp, startReceipt, traderReceipts } from '../services/wholesaleReceipts.js'

// The wholesaler / trader / packer workspace. Registration goes through the same KVIC review as a beekeeper's;
// the market and offers open once the regional officer approves the company.
const router = express.Router()
router.use(authenticateToken, requireRole('WHOLESALER'), loadOrganization)

const fail = (error, res) => {
  if (error instanceof TradeError) return res.status(error.status).json({ message: error.message })
  throw error
}
const round2 = (value) => Math.round(value * 100) / 100

// Works before approval too: the status screen and the profile page need it.
router.get('/summary', async (req, res) => {
  const counts = await db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END), 0) AS open,
      COALESCE(SUM(CASE WHEN status = 'ACCEPTED' THEN 1 ELSE 0 END), 0) AS accepted,
      COALESCE(SUM(CASE WHEN status = 'ACCEPTED' THEN quantity_kg ELSE 0 END), 0) AS bought_kg,
      COALESCE(SUM(CASE WHEN status = 'ACCEPTED' THEN quantity_kg * offer_price_per_kg ELSE 0 END), 0) AS spent
    FROM purchase_requests WHERE trader_org_id = ?
  `).get(req.org.id)

  res.json({
    organization: {
      code: req.org.organization_code, name: req.org.legal_name, status: req.org.status, state: req.org.state, region: req.org.region,
      gstin: req.org.gstin, fssai: req.org.fssai_license, registrationNo: req.org.madhukranti_id, reviewNote: req.org.review_note, reviewedAt: req.org.reviewed_at,
    },
    profile: await getProfile(req.org.id),
    missingDocuments: await missingRequiredDocuments(req.org.id),
    offices: await officesForOrganization(req.org),
    offers: { open: Number(counts.open), accepted: Number(counts.accepted), boughtKg: round2(Number(counts.bought_kg)), spentInr: round2(Number(counts.spent)) },
    filters: { states: Object.keys(REGIONS), honeyTypes: ALL_HONEY_TYPES },
  })
})

router.use(requireApprovedOrg)

router.get('/market', async (req, res) => {
  res.json(await marketListings({
    state: String(req.query.state || ''),
    honeyType: String(req.query.honeyType || ''),
    labVerifiedOnly: req.query.verified === '1',
  }))
})

router.get('/requests', async (req, res) => {
  res.json(await traderRequests(req.org.id))
})

router.post('/requests', async (req, res) => {
  try {
    const code = await createRequest(req.org, req.body || {})
    res.status(201).json({ code })
  } catch (error) { fail(error, res) }
})

router.post('/requests/:code/cancel', async (req, res) => {
  try {
    await cancelRequest(req.org, req.params.code)
    res.json({ status: 'CANCELLED' })
  } catch (error) { fail(error, res) }
})

// Honey received from a beekeeper, recorded from the wholesaler's side and confirmed by the keeper's OTP
// (services/wholesaleReceipts.js).
const receiptFail = (error, res) => {
  if (error instanceof ReceiptError) return res.status(error.status).json({ message: error.message })
  throw error
}

router.get('/receipts', async (req, res) => {
  res.json(await traderReceipts(req.org.id))
})

router.post('/receipts', async (req, res) => {
  try { res.status(201).json(await startReceipt(req.org, req.user, req.body || {})) } catch (error) { receiptFail(error, res) }
})

router.post('/receipts/:code/confirm', async (req, res) => {
  try { res.json(await confirmReceipt(req.org, req.params.code, req.body?.otp)) } catch (error) { receiptFail(error, res) }
})

router.post('/receipts/:code/resend', async (req, res) => {
  try { res.json(await resendReceiptOtp(req.org, req.params.code)) } catch (error) { receiptFail(error, res) }
})

router.post('/receipts/:code/cancel', async (req, res) => {
  try { await cancelReceipt(req.org, req.params.code); res.json({ status: 'CANCELLED' }) } catch (error) { receiptFail(error, res) }
})

export default router
