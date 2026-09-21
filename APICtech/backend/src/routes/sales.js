import express from 'express'

import db from '../database/database.js'
import { sealPendingBlock } from '../services/blockchain.js'
import { lockNamed } from '../services/ledgerLock.js'
import { batchCapacity, getBatch, packagingStatus } from '../services/batches.js'
import { getCompanyDb } from '../services/companyDb.js'
import { TransferError, recordTransfer } from '../services/custody.js'
import { appendTraceabilityEvent } from '../services/traceabilityLog.js'
import { syncMonthlyReport } from '../services/reports.js'
import { onLooseSale, onLooseSaleReversed } from '../services/chain.js'

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
const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && !Number.isNaN(Date.parse(value))
const today = () => new Date().toLocaleDateString('en-CA')
const clean = (value, max) => String(value ?? '').trim().slice(0, max)
const round2 = (value) => Math.round(value * 100) / 100
const MIN_GRAMS = 50

// The buyer's type decides which link of the public supply chain the hand-over is.
const PARTY_FOR = { Wholesaler: 'WHOLESALER', Company: 'WHOLESALER', Retailer: 'RETAILER', 'Direct Consumer': null }
const PARTY_LABEL = { WHOLESALER: 'Wholesaler', RETAILER: 'Retailer' }

async function nextCode(db2, table, prefix, column) {
  const key = `${prefix}-${new Date().getFullYear()}-`
  const highest = (await db2.prepare(`SELECT ${column} AS code FROM ${table} WHERE ${column} LIKE ?`).all(`${key}%`))
    .reduce((max, row) => Math.max(max, Number(row.code.slice(key.length)) || 0), 0)
  return `${key}${String(highest + 1).padStart(3, '0')}`
}

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
  if (!Number.isFinite(quantity) || grams < MIN_GRAMS) return res.status(400).json({ message: `Enter the quantity sold (at least ${MIN_GRAMS} g)` })

  const pricePerKg = Number(req.body.pricePerKg)
  if (!Number.isFinite(pricePerKg) || pricePerKg <= 0 || pricePerKg > 100000) return res.status(400).json({ message: 'Enter the agreed price per kg' })

  const gstPercent = Number(req.body.gstPercent || 0)
  if (!(gstPercent >= 0 && gstPercent <= 28)) return res.status(400).json({ message: 'GST must be between 0 and 28 percent' })

  const saleDate = req.body.saleDate || today()
  if (!isDate(saleDate) || saleDate > today() || saleDate < batch.harvest_date) {
    return res.status(400).json({ message: 'The sale date must be between the harvest date and today' })
  }

  const capacity = await batchCapacity(batch)
  if (grams > capacity.remainingGrams) {
    return res.status(409).json({
      code: 'NOT_ENOUGH_HONEY',
      message: `Only ${round2(capacity.remainingGrams / 1000)} kg of ${batch.batch_code} is left to sell. ${round2(capacity.packedGrams / 1000)} kg is reserved for QR jars and ${round2(capacity.looseGrams / 1000)} kg was already sold loose.`,
    })
  }

  const kg = grams / 1000
  const amount = round2(kg * pricePerKg)
  const gst = round2((amount * gstPercent) / 100)
  const party = PARTY_FOR[buyer.type] ?? null
  const publicName = req.body.publicName !== false
  const partyId = party ? (publicName ? buyer.name : `${PARTY_LABEL[party]} (name withheld)`) : null
  const paidNow = req.body.paid === true

  try {
    const created = await db2.transaction(async () => {
      await lockNamed(`sale:${req.org.id}`)

      // The honey check above ran before the lock; run it again so two requests cannot both take the last honey.
      await lockNamed(`honey:${batch.id}`)
      const fresh = await batchCapacity(batch)
      if (grams > fresh.remainingGrams) throw new TransferError(`Only ${round2(fresh.remainingGrams / 1000)} kg of ${batch.batch_code} is left to sell.`, 409)

      const code = await nextCode(db2, 'honey_sales', 'SAL', 'sale_code')
      const invoiceNumber = await nextCode(db2, 'invoices', 'INV', 'invoice_number')
      const description = `Loose honey ${batch.honey_type}, batch ${batch.batch_code} (${kg} kg at ₹${pricePerKg}/kg)`

      const invoiceId = (await db2.prepare(`
        INSERT INTO invoices (invoice_number, buyer_id, batch_code, issue_date, lines_json, subtotal_inr, gst_percent, gst_inr, total_inr, status, paid_at, finance_entry_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', NULL, NULL)
      `).run(invoiceNumber, buyer.id, batch.batch_code, saleDate, JSON.stringify([{ description, quantity: kg, unitPrice: pricePerKg }]),
        amount, gstPercent, gst, round2(amount + gst))).lastInsertRowid

      if (paidNow) {
        const entryId = (await db2.prepare(`
          INSERT INTO finance_entries (entry_date, type, category, description, amount_inr) VALUES (?, 'INCOME', 'Sales income', ?, ?)
        `).run(today(), `Invoice ${invoiceNumber} · ${buyer.name}`, round2(amount + gst))).lastInsertRowid
        await db2.prepare("UPDATE invoices SET status = 'Paid', paid_at = ?, finance_entry_id = ? WHERE id = ?").run(new Date().toISOString(), entryId, invoiceId)
      }

      const id = (await db2.prepare(`
        INSERT INTO honey_sales (sale_code, buyer_id, batch_code, quantity_grams, price_per_kg, amount_inr, sale_date, invoice_id, note, public_name, party_type, party_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(code, buyer.id, batch.batch_code, grams, pricePerKg, amount, saleDate, invoiceId, clean(req.body.note, 200), publicName ? 1 : 0, party, partyId)).lastInsertRowid

      await db.prepare("INSERT INTO loose_sales (sale_code, org_id, batch_id, grams, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(code, req.org.id, batch.id, grams, new Date().toISOString())

      if (party) {
        await recordTransfer({
          batch, actorType: 'KEEPER', actorId: req.user.id, toPartyType: party, toPartyId: partyId, quantityKg: kg,
          metadata: { sale: 'LOOSE', saleCode: code, grams }, createdBy: req.user.id,
        })
      } else {
        await appendTraceabilityEvent({
          entityType: 'BATCH', entityId: batch.batch_code, eventType: 'DIRECT_SALE_RECORDED',
          payload: { saleCode: code, quantityKg: kg, sale: 'LOOSE' }, createdBy: req.user.id,
        })
        await sealPendingBlock()
      }

      return { id, code, invoiceNumber, amountInr: amount, totalInr: round2(amount + gst) }
    })()

    if (paidNow) await syncMonthlyReport(req.org)
    await onLooseSale({ userId: req.user.id, organizationCode: req.org.organization_code, saleCode: created.code, batchCode: batch.batch_code, grams, buyerLabel: partyId || 'direct-consumer' })
    res.status(201).json(created)
  } catch (error) {
    if (error instanceof TransferError) return res.status(error.status).json({ message: error.message })
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

  await onLooseSaleReversed({ userId: req.user.id, organizationCode: req.org.organization_code, saleCode: sale.code, batchCode: sale.batchCode })
  res.json({ status: 'CANCELLED' })
})

export default router
