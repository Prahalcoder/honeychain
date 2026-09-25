import express from 'express'

import db from '../database/database.js'
import { sealPendingBlock } from '../services/blockchain.js'
import { batchCapacity, getBatch, packagingStatus } from '../services/batches.js'
import { getCompanyDb } from '../services/companyDb.js'
import { TransferError, recordTransfer } from '../services/custody.js'
import { appendTraceabilityEvent } from '../services/traceabilityLog.js'
import { onLooseSaleReversed } from '../services/chain.js'
import { MIN_GRAMS, SaleError, createLooseSale } from '../services/looseSales.js'
import { releaseForCancelledSale } from '../services/trade.js'

// Loose honey sold straight after harvest to a named wholesaler, in kg or grams, at a fixed
// price per kg. The wholesaler tests the honey on their own and sells it on, so no KVIC lab
// certificate is needed for this sale (packing your own QR jars still needs one).
// Each sale becomes a bill in Billing, can be marked paid (which books income in Finance),
// and is sealed on the blockchain as a hand-over of that many kilograms.
// Prices, buyer details and bills stay in the company's private database; the common
// database only learns how much honey left the batch, so the QR jar limit stays right.
// Mounted under /api/company/sales for approved organisations.
const router = express.Router()

const privateDb = async (req) => await getCompanyDb(req.org.organization_code)
const today = () => new Date().toLocaleDateString('en-CA')
const clean = (value, max) => String(value ?? '').trim().slice(0, max)
const round2 = (value) => Math.round(value * 100) / 100

// Honey of each harvest that can still be sold loose: harvested, minus what is reserved for QR jars, minus what was sold.
router.get('/stock', async (req, res) => {
  const batches = await db.prepare('SELECT * FROM batches WHERE org_id = ? ORDER BY id DESC').all(req.org.id)

  res.json(await Promise.all(batches.map(async (batch) => {
    const capacity = await batchCapacity(batch)
    return {
      batchCode: batch.batch_code,
      honeyType: batch.honey_type,
      harvestDate: batch.harvest_date,
      harvestedKg: batch.quantity_kg,
      packedKg: round2(capacity.packedGrams / 1000),
      soldLooseKg: round2(capacity.looseGrams / 1000),
      availableGrams: capacity.remainingGrams,
      availableKg: round2(capacity.remainingGrams / 1000),
      labStatus: (await packagingStatus(batch)).labStatus,
    }
  })))
})

async function listSales(req, where = '', params = []) {
  return (await (await privateDb(req)).prepare(`
    SELECT s.*, b.name AS buyer_name, b.type AS buyer_type, b.contact AS buyer_contact,
      i.invoice_number, i.status AS invoice_status, i.total_inr AS invoice_total, i.gst_percent
    FROM honey_sales s
    JOIN buyers b ON b.id = s.buyer_id
    LEFT JOIN invoices i ON i.id = s.invoice_id
    ${where} ORDER BY s.id DESC LIMIT 300
  `).all(...params)).map((row) => ({
    id: row.id,
    code: row.sale_code,
    status: row.status,
    buyerId: row.buyer_id,
    buyerName: row.buyer_name,
    buyerType: row.buyer_type,
    buyerContact: row.buyer_contact,
    batchCode: row.batch_code,
    quantityGrams: row.quantity_grams,
    quantityKg: round2(row.quantity_grams / 1000),
    pricePerKg: row.price_per_kg,
    amountInr: row.amount_inr,
    totalInr: row.invoice_total ?? row.amount_inr,
    gstPercent: row.gst_percent ?? 0,
    saleDate: row.sale_date,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    paymentStatus: row.invoice_status || null,
    note: row.note,
    publicName: Boolean(row.public_name),
    cancelReason: row.cancel_reason,
  }))
}

router.get('/', async (req, res) => {
  res.json(await listSales(req))
})

router.post('/', async (req, res) => {
  const db2 = await privateDb(req)
  const buyer = await db2.prepare('SELECT * FROM buyers WHERE id = ?').get(Number(req.body.buyerId))
  if (!buyer) return res.status(400).json({ message: 'Choose the buyer. Add the wholesaler under Buyers if they are not listed.' })

  const batch = await getBatch(String(req.body.batchCode || ''))
  if (!batch || batch.org_id !== req.org.id) return res.status(404).json({ message: 'Choose one of your harvest batches' })

  const unit = req.body.unit === 'g' ? 'g' : 'kg'
  const quantity = Number(req.body.quantity)
  const grams = Math.round(unit === 'g' ? quantity : quantity * 1000)
  if (!Number.isFinite(quantity)) return res.status(400).json({ message: `Enter the quantity sold (at least ${MIN_GRAMS} g)` })

  try {
    const created = await createLooseSale({
      org: req.org, user: req.user, privateDb: db2, buyer, batch, grams,
      pricePerKg: Number(req.body.pricePerKg), gstPercent: Number(req.body.gstPercent || 0),
      saleDate: req.body.saleDate || today(), paid: req.body.paid === true, publicName: req.body.publicName !== false, note: req.body.note,
    })
    res.status(201).json(created)
  } catch (error) {
    if (error instanceof SaleError) return res.status(error.status).json({ message: error.message, ...(error.code ? { code: error.code } : {}) })
    throw error
  }
})

// A sale can be undone while its bill is still unpaid: the honey goes back to the batch and the hand-over is reversed.
router.post('/:id/cancel', async (req, res) => {
  const db2 = await privateDb(req)
  const [sale] = await listSales(req, 'WHERE s.id = ?', [Number(req.params.id)])
  if (!sale) return res.status(404).json({ message: 'Sale not found' })
  if (sale.status !== 'ACTIVE') return res.status(409).json({ message: 'This sale was already cancelled' })
  if (sale.paymentStatus === 'Paid') return res.status(409).json({ message: 'A paid sale cannot be cancelled here. Adjust it in Finance if money was returned.' })

  const reason = clean(req.body.reason, 160)
  if (reason.length < 3) return res.status(400).json({ message: 'Say why the sale is cancelled (at least 3 characters)' })

  const raw = await db2.prepare('SELECT * FROM honey_sales WHERE id = ?').get(sale.id)
  const batch = await getBatch(sale.batchCode)

  try {
    await db2.transaction(async () => {
      await db2.prepare("UPDATE honey_sales SET status = 'CANCELLED', cancel_reason = ? WHERE id = ?").run(reason, sale.id)
      if (sale.invoiceId) await db2.prepare("UPDATE invoices SET status = 'Cancelled' WHERE id = ? AND status = 'Pending'").run(sale.invoiceId)
      await db.prepare("UPDATE loose_sales SET status = 'CANCELLED' WHERE sale_code = ? AND org_id = ?").run(sale.code, req.org.id)

      if (raw.party_type) {
        await recordTransfer({
          batch, actorType: 'KEEPER', actorId: req.user.id, fromPartyType: raw.party_type, fromPartyId: raw.party_id,
          toPartyType: 'APICTECH', toPartyId: 'APICTECH', quantityKg: sale.quantityKg,
          metadata: { sale: 'LOOSE', saleCode: sale.code, returned: true, reason }, createdBy: req.user.id,
        })
      } else {
        await appendTraceabilityEvent({
          entityType: 'BATCH', entityId: batch.batch_code, eventType: 'DIRECT_SALE_REVERSED',
          payload: { saleCode: sale.code, quantityKg: sale.quantityKg, sale: 'LOOSE' }, createdBy: req.user.id,
        })
        await sealPendingBlock()
      }
    })()
  } catch (error) {
    if (error instanceof TransferError) return res.status(error.status).json({ message: error.message })
    throw error
  }

  await releaseForCancelledSale(req.org.id, sale.code)
  await onLooseSaleReversed({ userId: req.user.id, organizationCode: req.org.organization_code, saleCode: sale.code, batchCode: sale.batchCode })
  res.json({ status: 'CANCELLED' })
})

export default router
