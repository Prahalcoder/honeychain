import bcrypt from 'bcryptjs'
import express from 'express'

import db from '../database/database.js'
import { authenticateToken, loadOrganization, requireApprovedOrg, requireRole } from '../middleware/auth.js'
import { sealPendingBlock } from '../services/blockchain.js'
import { lockNamed } from '../services/ledgerLock.js'
import { batchCapacity, createChainBatch, getBatch, packagingStatus, parseJson } from '../services/batches.js'
import { getCompanyDb, nextHiveCode } from '../services/companyDb.js'
import { TransferError, recordTransfer } from '../services/custody.js'
import { applicableItems, closureView, getOpenClosure } from '../services/closure.js'
import { buildInsights } from '../services/insights.js'
import { keeperInspections, upcomingFor } from '../services/inspections.js'
import { visibleAnnouncements } from '../services/announcements.js'
import { pdfBody, saveDocument, sendDocument } from '../services/labDocuments.js'
import salesRoutes from './sales.js'
import shopKeeperRoutes from './shopKeeper.js'
import { openShopOrders } from '../services/shop.js'
import { onHarvest } from '../services/chain.js'
import { TicketError, keeperReply, keeperThread, keeperTicketNotices, keeperTickets, openTicket, getTicket } from '../services/tickets.js'
import { analyzeLabResult } from '../services/labAnalysis.js'
import { currentMonth, recentMonths, syncMonthlyReport } from '../services/reports.js'
import { appendTraceabilityEvent } from '../services/traceabilityLog.js'

// Everything here is scoped to the signed-in beekeeper's own company.
const router = express.Router()
router.use(authenticateToken, requireRole('BEEKEEPER'), loadOrganization)

const HONEY_TYPES = ['Natural Honey', 'Forest Honey', 'Wildflower Honey', 'Floral Honey', 'Other']
const FINANCE_CATEGORIES = ['Sales income', 'Labor', 'Packaging', 'Maintenance', 'Operations', 'Other']
const LAB_OUTCOMES = ['PASSED', 'FAILED']
const DISTRIBUTOR_TYPES = ['WHOLESALER', 'RETAILER']
const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
const today = () => new Date().toLocaleDateString('en-CA')

const companyDb = async (req) => await getCompanyDb(req.org.organization_code)

// The farm name the keeper gave (Settings), else the organisation name they registered with.
async function farmNameOf(req) {
  const settings = await db.prepare('SELECT farm_name FROM user_settings WHERE user_id = ?').get(req.user.id)
  return String(settings?.farm_name || '').trim() || req.org.legal_name
}

// ---------------------------------------------------------------- overview
router.get('/summary', async (req, res) => {
  const privateDb = await companyDb(req)
  const month = currentMonth()

  const hives = await privateDb.prepare(`
    SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END), 0) AS active FROM hives
  `).get()

  const stock = await db.prepare(`
    SELECT COALESCE(SUM(quantity_kg), 0) AS kg, COUNT(*) AS batches FROM batches WHERE org_id = ?
  `).get(req.org.id)

  const money = await privateDb.prepare(`
    SELECT COALESCE(SUM(CASE WHEN type = 'INCOME' THEN amount_inr END), 0) AS income,
      COALESCE(SUM(CASE WHEN type = 'EXPENSE' THEN amount_inr END), 0) AS expense
    FROM finance_entries WHERE substr(entry_date, 1, 7) = ?
  `).get(month)

  const bottles = (await db.prepare(`
    SELECT COUNT(*) AS count FROM packs p
    JOIN pack_batches pb ON pb.id = p.pack_batch_id
    JOIN batches b ON b.id = pb.batch_id
    WHERE b.org_id = ?
  `).get(req.org.id)).count

  const pendingLab = (await db.prepare(`
    SELECT COUNT(*) AS count FROM lab_reviews WHERE org_id = ? AND status = 'PENDING'
  `).get(req.org.id)).count

  res.json({
    farmName: await farmNameOf(req),
    organization: {
      code: req.org.organization_code,
      name: req.org.legal_name,
      status: req.org.status,
      state: req.org.state,
      region: req.org.region,
      reviewNote: req.org.review_note,
      closure: await (async () => { const open = await getOpenClosure(req.org.id); return open ? { reason: open.reason, initiatedBy: open.initiated_by_role } : null })(),
    },
    hives,
    honeyStockKg: stock.kg,
    batches: stock.batches,
    bottles,
    pendingLabReviews: pendingLab,
    inspection: await upcomingFor(req.org.id),
    month,
    monthIncome: money.income,
    monthExpense: money.expense,
  })
})

// ------------------------------------------------------ closing the company
// The keeper asks for the organisation to be closed. A KVIC officer then works
// through the government formalities (FSSAI surrender, GST cancellation, ...)
// before the closure is completed. See services/closure.js.
router.get('/closure', async (req, res) => {
  const open = await getOpenClosure(req.org.id)

  res.json({
    status: req.org.status,
    items: applicableItems(req.org),
    request: open ? closureView(open) : null,
  })
})

router.post('/closure', async (req, res) => {
  if (req.org.status !== 'APPROVED') {
    return res.status(409).json({ message: 'Only an approved organisation can request closure' })
  }

  const reason = String(req.body.reason || '').trim().slice(0, 400)
  const declarations = req.body.declarations || {}

  if (reason.length < 5) return res.status(400).json({ message: 'Tell your officer why you are closing (at least 5 characters)' })
  if (!declarations.dues || !declarations.stock || !declarations.records) {
    return res.status(400).json({ message: 'Tick all three declarations to continue' })
  }

  const account = await db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id)
  if (!(await bcrypt.compare(String(req.body.password || ''), account.password))) {
    return res.status(400).json({ message: 'Password confirmation failed' })
  }

  const openOrders = await openShopOrders(req.org.organization_code)
  if (openOrders > 0) {
    return res.status(409).json({ message: `You still have ${openOrders} open order(s) on the Sellers nearby page. Ship or cancel them before closing.` })
  }

  await db.transaction(async () => {
    await db.prepare(`
      INSERT INTO closure_requests (org_id, initiated_by, initiated_by_role, reason, declarations_json)
      VALUES (?, ?, 'BEEKEEPER', ?, ?)
    `).run(req.org.id, req.user.id, reason, JSON.stringify({ dues: true, stock: true, records: true }))
    await db.prepare("UPDATE organizations SET status = 'CLOSURE_PENDING' WHERE id = ?").run(req.org.id)

    await appendTraceabilityEvent({
      entityType: 'ORGANIZATION',
      entityId: req.org.organization_code,
      eventType: 'ORGANIZATION_CLOSURE_REQUESTED',
      payload: { organizationCode: req.org.organization_code, requestedBy: 'BEEKEEPER' },
      createdBy: req.user.id,
    })
    await sealPendingBlock()
  })()

  res.status(201).json({ status: 'CLOSURE_PENDING' })
})

router.delete('/closure', async (req, res) => {
  const open = await getOpenClosure(req.org.id)

  if (!open || open.initiated_by_role !== 'BEEKEEPER') {
    return res.status(409).json({ message: 'There is no closure request of yours to withdraw' })
  }

  await db.transaction(async () => {
    await db.prepare("UPDATE closure_requests SET status = 'WITHDRAWN' WHERE id = ?").run(open.id)
    await db.prepare("UPDATE organizations SET status = 'APPROVED' WHERE id = ?").run(req.org.id)
  })()

  res.json({ status: 'APPROVED' })
})
// A registration does not activate the account. Until a regional officer has
// approved the organisation the keeper can sign in and read its status, but the
// rest of the workspace stays closed.
router.get('/notifications', listNotifications)

// Notice board: notices from KVIC officers that are addressed to this keeper.
const keeperViewer = (req) => ({ role: 'BEEKEEPER', org: { id: req.org.id, state: req.org.state, region: req.org.region } })

router.get('/announcements', async (req, res) => {
  res.json(await visibleAnnouncements(keeperViewer(req), { limit: 30 }))
})

// Help desk. Each question is a ticket: a conversation with your regional officer, who alone can close it.
router.get('/support', async (req, res) => {
  const officers = await db.prepare(`
    SELECT name, role, region, state FROM users
    WHERE active = 1 AND ((role = 'REGIONAL_OFFICER' AND state = ? AND region = ?) OR (role = 'STATE_OFFICER' AND state = ?))
    ORDER BY role DESC
  `).all(req.org.state, req.org.region, req.org.state)

  res.json({ officers, organization: { name: req.org.legal_name, state: req.org.state, region: req.org.region, status: req.org.status } })
})

const ticketFail = (error, res) => {
  if (error instanceof TicketError) return res.status(error.status).json({ message: error.message })
  throw error
}

router.get('/tickets', async (req, res) => {
  res.json(await keeperTickets(req.org))
})

router.post('/tickets', async (req, res) => {
  try {
    res.status(201).json(await openTicket({ org: req.org, user: req.user, subject: req.body.subject, message: req.body.message }))
  } catch (error) { ticketFail(error, res) }
})

router.get('/tickets/:id', async (req, res) => {
  const thread = await keeperThread(req.org, req.params.id)
  if (!thread) return res.status(404).json({ message: 'Ticket not found' })
  res.json(thread)
})

router.post('/tickets/:id/messages', async (req, res) => {
  const ticket = await getTicket(req.params.id)
  if (!ticket || ticket.org_id !== req.org.id) return res.status(404).json({ message: 'Ticket not found' })

  try {
    await keeperReply({ ticket, user: req.user, body: req.body.body })
    res.status(201).json({ sent: true })
  } catch (error) { ticketFail(error, res) }
})

// Inspection notices and reports. Available even while the organisation is suspended.
router.get('/inspections', async (req, res) => {
  res.json(await keeperInspections(req.org.id))
})

router.post('/inspections/:id/acknowledge', async (req, res) => {
  const row = await db.prepare("SELECT id, status, acknowledged_at FROM inspections WHERE id = ? AND org_id = ?").get(Number(req.params.id), req.org.id)
  if (!row || row.status !== 'SCHEDULED') return res.status(404).json({ message: 'No scheduled inspection found' })

  if (!row.acknowledged_at) {
    await db.prepare('UPDATE inspections SET acknowledged_at = ? WHERE id = ?').run(new Date().toISOString(), row.id)
  }
  res.json({ acknowledged: true })
})

router.use(requireApprovedOrg)
router.use('/sales', salesRoutes)
router.use('/shop', shopKeeperRoutes)

// ------------------------------------------------------------------- hives
router.get('/hives', async (req, res) => {
  res.json(await (await companyDb(req)).prepare('SELECT * FROM hives ORDER BY hive_code').all())
})

router.post('/hives', async (req, res) => {
  const privateDb = await companyDb(req)
  const name = String(req.body.name || '').trim().slice(0, 60)
  const location = String(req.body.location || '').trim().slice(0, 80) || await farmNameOf(req)
  const hiveCode = await privateDb.transaction(async () => {
    await lockNamed(`hive:${req.org.id}`)
    const code = await nextHiveCode(privateDb)
    await privateDb.prepare('INSERT INTO hives (hive_code, name, location) VALUES (?, ?, ?)')
      .run(code, name || `Hive ${Number(code.slice(1))}`, location)
    return code
  })()

  res.status(201).json(await privateDb.prepare('SELECT * FROM hives WHERE hive_code = ?').get(hiveCode))
})

// ---------------------------------------------------------------- harvests
router.get('/harvests', async (req, res) => {
  res.json(await (await companyDb(req)).prepare('SELECT * FROM harvests ORDER BY harvest_date DESC, id DESC').all())
})

router.post('/harvests', async (req, res) => {
  const privateDb = await companyDb(req)
  const { hiveCode, harvestDate, honeyType = 'Natural Honey', location = '', notes = '' } = req.body
  const quantityKg = Number(req.body.quantityKg)

  if (!await privateDb.prepare('SELECT 1 FROM hives WHERE hive_code = ?').get(hiveCode)) {
    return res.status(400).json({ message: 'Choose one of your registered hives' })
  }

  if (!Number.isFinite(quantityKg) || quantityKg <= 0 || quantityKg > 100000) {
    return res.status(400).json({ message: 'Quantity must be a positive number of kilograms' })
  }

  if (!isDate(harvestDate) || harvestDate > today()) {
    return res.status(400).json({ message: 'Harvest date must be a valid date that is not in the future' })
  }

  const oldest = new Date()
  oldest.setFullYear(oldest.getFullYear() - 2)
  if (harvestDate < oldest.toLocaleDateString('en-CA')) {
    return res.status(400).json({ message: 'Harvest date is more than two years ago. Check the date.' })
  }

  const type = HONEY_TYPES.includes(honeyType) ? honeyType : 'Other'
  const kg = Math.round(quantityKg * 1000) / 1000

  const batchCode = await createChainBatch({
    organization: req.org,
    userId: req.user.id,
    hiveCode,
    quantityKg: kg,
    honeyType: type,
    harvestDate,
  })

  await onHarvest({ userId: req.user.id, batchCode, quantityKg: kg, harvestDate })

  await privateDb.prepare(`
    INSERT INTO harvests (batch_code, hive_code, harvest_date, honey_type, quantity_kg, location, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(batchCode, hiveCode, harvestDate, type, kg, (String(location).trim() || await farmNameOf(req)).slice(0, 80), String(notes).slice(0, 500))

  res.status(201).json(await privateDb.prepare('SELECT * FROM harvests WHERE batch_code = ?').get(batchCode))
})

// ------------------------------------------------------------------ batches
// The company's batches on the shared chain, with bottle capacity for QR creation.
router.get('/batches', async (req, res) => {
  const rows = await db.prepare(`
    SELECT b.*, (
      SELECT r.status FROM lab_reviews r
      WHERE r.batch_id = b.id ORDER BY r.id DESC LIMIT 1
    ) AS lab_review_status
    FROM batches b WHERE b.org_id = ? ORDER BY b.created_at DESC, b.id DESC
  `).all(req.org.id)

  res.json(await Promise.all(rows.map(async (batch) => ({ ...batch, capacity: await batchCapacity(batch), packaging: await packagingStatus(batch) }))))
})

// ------------------------------------------------------------------ finance
router.get('/finance', async (req, res) => {
  const privateDb = await companyDb(req)
  const months = recentMonths(6)

  const totals = await privateDb.prepare(`
    SELECT substr(entry_date, 1, 7) AS month,
      COALESCE(SUM(CASE WHEN type = 'INCOME' THEN amount_inr END), 0) AS income,
      COALESCE(SUM(CASE WHEN type = 'EXPENSE' THEN amount_inr END), 0) AS expense
    FROM finance_entries GROUP BY month
  `).all()

  const byMonth = new Map(totals.map((row) => [row.month, row]))

  res.json({
    entries: await privateDb.prepare('SELECT * FROM finance_entries ORDER BY entry_date DESC, id DESC LIMIT 300').all(),
    trend: months.map((month) => ({
      month,
      income: byMonth.get(month)?.income || 0,
      expense: byMonth.get(month)?.expense || 0,
    })),
    categories: FINANCE_CATEGORIES,
  })
})

router.post('/finance', async (req, res) => {
  const { type, category, description, entryDate } = req.body
  const amount = Number(req.body.amount)

  if (!['INCOME', 'EXPENSE'].includes(type)) {
    return res.status(400).json({ message: 'Type must be INCOME or EXPENSE' })
  }

  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) {
    return res.status(400).json({ message: 'Amount must be a positive number' })
  }

  if (!isDate(entryDate)) {
    return res.status(400).json({ message: 'Enter a valid date' })
  }

  const privateDb = await companyDb(req)
  const result = await privateDb.prepare(`
    INSERT INTO finance_entries (entry_date, type, category, description, amount_inr)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    entryDate,
    type,
    FINANCE_CATEGORIES.includes(category) ? category : 'Other',
    String(description || '').trim().slice(0, 120) || 'Transaction',
    Math.round(amount * 100) / 100,
  )

  await syncMonthlyReport(req.org)
  res.status(201).json(await privateDb.prepare('SELECT * FROM finance_entries WHERE id = ?').get(result.lastInsertRowid))
})

router.delete('/finance/:id', async (req, res) => {
  const result = await (await companyDb(req)).prepare('DELETE FROM finance_entries WHERE id = ?').run(Number(req.params.id))
  if (result.changes === 0) return res.status(404).json({ message: 'Entry not found' })

  await syncMonthlyReport(req.org)
  res.json({ message: 'Entry deleted' })
})

// ----------------------------------------------------------- buyers, billing
// Stored in the company's private database. Nothing is pre-filled for a new keeper.
const BUYER_TYPES = ['Wholesaler', 'Retailer', 'Company', 'Direct Consumer']
const round2 = (value) => Math.round(value * 100) / 100

const nextSequence = async (privateDb, table, prefix, column) => {
  const year = new Date().getFullYear()
  const key = `${prefix}-${year}-`
  const highest = (await privateDb.prepare(`SELECT ${column} AS code FROM ${table} WHERE ${column} LIKE ?`)
    .all(`${key}%`))
    .reduce((max, row) => Math.max(max, Number(row.code.slice(key.length)) || 0), 0)

  return `${key}${String(highest + 1).padStart(3, '0')}`
}

router.get('/buyers', async (req, res) => {
  const privateDb = await companyDb(req)
  const rows = await privateDb.prepare(`
    SELECT b.*,
      COALESCE((SELECT SUM(total_inr) FROM invoices i WHERE i.buyer_id = b.id AND i.status = 'Paid'), 0) AS purchases_inr,
      COALESCE((SELECT SUM(total_inr) FROM invoices i WHERE i.buyer_id = b.id AND i.status = 'Pending'), 0) AS pending_inr,
      (SELECT COUNT(*) FROM invoices i WHERE i.buyer_id = b.id) AS invoice_count
    FROM buyers b ORDER BY b.id DESC
  `).all()

  res.json(rows)
})

router.post('/buyers', async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80)
  const type = BUYER_TYPES.includes(req.body.type) ? req.body.type : null

  if (!name || !type) return res.status(400).json({ message: 'Buyer name and type are required' })

  const gstin = String(req.body.gstin || '').trim().toUpperCase().slice(0, 15)
  if (gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) {
    return res.status(400).json({ message: 'GSTIN format is invalid' })
  }

  const privateDb = await companyDb(req)
  const result = await privateDb.prepare('INSERT INTO buyers (name, type, contact, gstin, address) VALUES (?, ?, ?, ?, ?)')
    .run(name, type, String(req.body.contact || '').trim().slice(0, 40), gstin,
      String(req.body.address || '').trim().slice(0, 160))

  res.status(201).json(await privateDb.prepare('SELECT * FROM buyers WHERE id = ?').get(result.lastInsertRowid))
})

router.delete('/buyers/:id', async (req, res) => {
  const privateDb = await companyDb(req)
  const id = Number(req.params.id)
  const used = (await privateDb.prepare('SELECT COUNT(*) AS count FROM invoices WHERE buyer_id = ?').get(id)).count

  if (used > 0) return res.status(409).json({ message: 'This buyer has invoices and cannot be removed' })

  const result = await privateDb.prepare('DELETE FROM buyers WHERE id = ?').run(id)
  if (result.changes === 0) return res.status(404).json({ message: 'Buyer not found' })
  res.json({ message: 'Buyer removed' })
})

async function sellerDetails(req) {
  const settings = await db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(req.user.id) || {}

  return {
    name: req.org.legal_name,
    gstin: req.org.gstin || settings.gstin || '',
    fssai: req.org.fssai_license,
    address: settings.business_address || `${req.org.region}, ${req.org.state}`,
    phone: settings.phone || '',
  }
}

router.get('/invoices', async (req, res) => {
  const rows = await (await companyDb(req)).prepare(`
    SELECT i.*, b.name AS buyer_name, b.gstin AS buyer_gstin, b.address AS buyer_address
    FROM invoices i JOIN buyers b ON b.id = i.buyer_id ORDER BY i.id DESC
  `).all()

  res.json({
    seller: await sellerDetails(req),
    invoices: rows.map((row) => ({ ...row, lines: parseJson(row.lines_json) || [], lines_json: undefined })),
  })
})

router.post('/invoices', async (req, res) => {
  const privateDb = await companyDb(req)
  const buyer = await privateDb.prepare('SELECT id FROM buyers WHERE id = ?').get(Number(req.body.buyerId))
  if (!buyer) return res.status(400).json({ message: 'Choose a buyer' })

  const lines = (Array.isArray(req.body.lines) ? req.body.lines : []).slice(0, 30).map((line) => ({
    description: String(line.description || '').trim().slice(0, 120),
    quantity: Number(line.quantity),
    unitPrice: Number(line.unitPrice),
  }))

  if (lines.length === 0 || lines.some((line) => !line.description || !(line.quantity > 0) || !(line.unitPrice >= 0))) {
    return res.status(400).json({ message: 'Every invoice line needs a description, a positive quantity and a price' })
  }

  const gstPercent = Number(req.body.gstPercent || 0)
  if (!(gstPercent >= 0 && gstPercent <= 28)) return res.status(400).json({ message: 'GST must be between 0 and 28 percent' })

  const issueDate = req.body.issueDate || today()
  const dueDate = req.body.dueDate || null
  if (!isDate(issueDate) || (dueDate && !isDate(dueDate))) return res.status(400).json({ message: 'Enter valid dates' })

  let batchCode = null
  if (req.body.batchCode) {
    const batch = await getBatch(req.body.batchCode)
    if (!batch || batch.org_id !== req.org.id) return res.status(400).json({ message: 'Batch not found in your organisation' })
    batchCode = batch.batch_code
  }

  const subtotal = round2(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0))
  const gst = round2((subtotal * gstPercent) / 100)
  const number = await privateDb.transaction(async () => {
    await lockNamed(`invoice:${req.org.id}`)
    const next = await nextSequence(privateDb, 'invoices', 'INV', 'invoice_number')

    await privateDb.prepare(`
      INSERT INTO invoices
      (invoice_number, buyer_id, batch_code, issue_date, due_date, lines_json, subtotal_inr, gst_percent, gst_inr, total_inr)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(next, buyer.id, batchCode, issueDate, dueDate, JSON.stringify(lines), subtotal, gstPercent, gst, round2(subtotal + gst))
    return next
  })()

  res.status(201).json(await privateDb.prepare('SELECT * FROM invoices WHERE invoice_number = ?').get(number))
})

// Marking an invoice paid books the income in the finance ledger.
router.patch('/invoices/:id', async (req, res) => {
  const privateDb = await companyDb(req)
  const invoice = await privateDb.prepare('SELECT i.*, b.name AS buyer_name FROM invoices i JOIN buyers b ON b.id = i.buyer_id WHERE i.id = ?')
    .get(Number(req.params.id))

  if (!invoice) return res.status(404).json({ message: 'Invoice not found' })
  if (invoice.status !== 'Pending') return res.status(409).json({ message: `This invoice is already ${invoice.status.toLowerCase()}` })
  if (!['Paid', 'Cancelled'].includes(req.body.status)) return res.status(400).json({ message: 'Status must be Paid or Cancelled' })

  await privateDb.transaction(async () => {
    let entryId = null

    if (req.body.status === 'Paid') {
      entryId = (await privateDb.prepare(`
        INSERT INTO finance_entries (entry_date, type, category, description, amount_inr)
        VALUES (?, 'INCOME', 'Sales income', ?, ?)
      `).run(today(), `Invoice ${invoice.invoice_number} · ${invoice.buyer_name}`, invoice.total_inr)).lastInsertRowid
    }

    await privateDb.prepare('UPDATE invoices SET status = ?, paid_at = ?, finance_entry_id = ? WHERE id = ?')
      .run(req.body.status, req.body.status === 'Paid' ? new Date().toISOString() : null, entryId, invoice.id)
  })()

  if (req.body.status === 'Paid') await syncMonthlyReport(req.org)
  res.json({ status: req.body.status })
})

// ---------------------------------------------------------------- inventory
// Derived from the chain, never typed in: what was harvested, what sits in
// bottles, what has moved on and what the keeper still holds.
router.get('/inventory', async (req, res) => {
  const batches = await db.prepare('SELECT * FROM batches WHERE org_id = ? ORDER BY id DESC').all(req.org.id)
  const balances = await db.prepare(`
    SELECT batch_id, quantity_kg FROM custody_balances
    WHERE party_type = 'APICTECH' AND batch_id IN (SELECT id FROM batches WHERE org_id = ?)
  `).all(req.org.id)
  const holdingByBatch = new Map(balances.map((row) => [row.batch_id, row.quantity_kg]))

  const items = await Promise.all(batches.map(async (batch) => {
    const capacity = await batchCapacity(batch)
    const holdingKg = holdingByBatch.has(batch.id) ? holdingByBatch.get(batch.id) : batch.quantity_kg
    const packedKg = capacity.packedGrams / 1000

    return {
      batchCode: batch.batch_code,
      hiveCode: batch.hive_code,
      honeyType: batch.honey_type,
      harvestDate: batch.harvest_date,
      harvestedKg: batch.quantity_kg,
      holdingKg: round2(holdingKg),
      transferredKg: round2(batch.quantity_kg - holdingKg),
      packedBottles: capacity.packedBottles,
      packedKg: round2(packedKg),
      looseSoldKg: round2(capacity.looseGrams / 1000),
      unpackedKg: round2(Math.max(0, batch.quantity_kg - packedKg - capacity.looseGrams / 1000)),
      lab: await packagingStatus(batch),
    }
  }))

  const sum = (key) => round2(items.reduce((total, item) => total + item[key], 0))

  res.json({
    items,
    totals: {
      harvestedKg: sum('harvestedKg'),
      holdingKg: sum('holdingKg'),
      transferredKg: sum('transferredKg'),
      packedBottles: items.reduce((total, item) => total + item.packedBottles, 0),
    },
  })
})

// ------------------------------------------------------------- lab workflow
// 1. The keeper requests a lab test for a batch.
// 2. The lab's certificate is attached to that request; it goes to the regional
//    officer together with an AI-assisted analysis.
// 3. The officer verifies it with a digital signature (see routes/admin.js).
router.get('/lab-requests', async (req, res) => {
  const rows = await db.prepare(`
    SELECT lr.id AS request_id, lr.status AS request_status, lr.lab_name AS requested_lab,
      lr.note AS request_note, lr.created_at AS requested_at, b.batch_code, b.quantity_kg, b.honey_type,
      t.id AS test_id, t.lab_name, t.status AS declared_status, t.certificate_reference,
      t.results_json, t.tested_at,
      r.id AS review_id, r.status AS review_status, r.review_note, r.reviewed_at, r.signed_at,
      r.document_name, r.document_size, r.document_uploaded_at,
      u.name AS reviewed_by, k.fingerprint AS signature_fingerprint
    FROM lab_requests lr
    JOIN batches b ON b.id = lr.batch_id
    LEFT JOIN laboratory_tests t ON t.id = lr.lab_test_id
    LEFT JOIN lab_reviews r ON r.lab_test_id = t.id
    LEFT JOIN users u ON u.id = r.reviewed_by
    LEFT JOIN officer_keys k ON k.id = r.signing_key_id
    WHERE lr.org_id = ?
    ORDER BY lr.id DESC
  `).all(req.org.id)

  res.json(rows.map((row) => ({ ...row, results: parseJson(row.results_json), results_json: undefined })))
})

router.post('/lab-requests', async (req, res) => {
  const batch = await getBatch(req.body.batchCode)

  if (!batch || batch.org_id !== req.org.id) {
    return res.status(404).json({ message: 'Batch not found in your organisation' })
  }

  const labName = String(req.body.labName || '').trim().slice(0, 80)
  if (!labName) return res.status(400).json({ message: 'Choose the laboratory that will test the sample' })

  if ((await packagingStatus(batch)).unlocked) {
    return res.status(409).json({ message: 'This batch already has a verified laboratory certificate' })
  }

  const open = await db.prepare(`
    SELECT 1 FROM lab_requests lr WHERE lr.batch_id = ? AND lr.status = 'REQUESTED'
    UNION ALL
    SELECT 1 FROM lab_reviews WHERE batch_id = ? AND status = 'PENDING'
  `).get(batch.id, batch.id)

  if (open) {
    return res.status(409).json({ message: 'This batch already has a lab test in progress' })
  }

  const requestId = await db.transaction(async () => {
    const result = await db.prepare(`
      INSERT INTO lab_requests (batch_id, org_id, lab_name, note) VALUES (?, ?, ?, ?)
    `).run(batch.id, req.org.id, labName, String(req.body.note || '').trim().slice(0, 300) || null)

    await appendTraceabilityEvent({
      entityType: 'BATCH',
      entityId: batch.batch_code,
      eventType: 'LAB_TEST_REQUESTED',
      payload: { labRequestId: result.lastInsertRowid, labName },
      createdBy: req.user.id,
    })
    await sealPendingBlock()

    return result.lastInsertRowid
  })()

  res.status(201).json({ requestId, status: 'REQUESTED' })
})

// The laboratory's certificate is submitted into Honey Chain against the request.
router.post('/lab-requests/:id/result', async (req, res) => {
  const request = await db.prepare('SELECT * FROM lab_requests WHERE id = ? AND org_id = ?')
    .get(Number(req.params.id), req.org.id)

  if (!request) return res.status(404).json({ message: 'Lab request not found' })
  if (request.status !== 'REQUESTED') {
    return res.status(409).json({ message: 'A certificate was already submitted for this request' })
  }

  const batch = await db.prepare('SELECT * FROM batches WHERE id = ?').get(request.batch_id)
  const { certificateReference, status = 'PASSED', testedAt, results = {} } = req.body
  const labName = String(req.body.labName || request.lab_name).trim()

  if (!labName || !String(certificateReference || '').trim()) {
    return res.status(400).json({ message: 'Laboratory name and certificate number are required' })
  }

  if (!LAB_OUTCOMES.includes(status)) {
    return res.status(400).json({ message: 'Status must be PASSED or FAILED as stated on the certificate' })
  }

  if (!isDate(testedAt) || testedAt > today()) {
    return res.status(400).json({ message: 'Test date must be a valid date that is not in the future' })
  }

  const numeric = (value) => (value === '' || value === undefined || value === null ? null : Number(value))
  const cleanResults = {
    moisturePercent: numeric(results.moisturePercent),
    hmfMgPerKg: numeric(results.hmfMgPerKg),
    sucrosePercent: numeric(results.sucrosePercent),
    antibiotics: String(results.antibiotics || '').slice(0, 40) || null,
    notes: String(results.notes || '').slice(0, 300) || null,
  }

  const reference = String(certificateReference).trim()

  const analysis = await analyzeLabResult({
    results: cleanResults,
    declaredStatus: status,
    testedAt,
    harvestDate: batch.harvest_date,
    certificateReference: reference,
    batchId: batch.id,
  })

  const reviewId = await db.transaction(async () => {
    const test = await db.prepare(`
      INSERT INTO laboratory_tests
      (batch_id, lab_name, status, certificate_reference, results_json, tested_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(batch.id, labName, status, reference, JSON.stringify(cleanResults), testedAt)

    const review = await db.prepare(`
      INSERT INTO lab_reviews (lab_test_id, batch_id, org_id, ai_analysis_json) VALUES (?, ?, ?, ?)
    `).run(test.lastInsertRowid, batch.id, req.org.id, JSON.stringify(analysis))

    await db.prepare("UPDATE lab_requests SET status = 'RESULT_SUBMITTED', lab_test_id = ? WHERE id = ?")
      .run(test.lastInsertRowid, request.id)

    await appendTraceabilityEvent({
      entityType: 'BATCH',
      entityId: batch.batch_code,
      eventType: 'LAB_RESULT_SUBMITTED',
      payload: {
        labTestId: test.lastInsertRowid,
        labName,
        certificateReference: reference,
        declaredStatus: status,
        testedAt,
        aiRiskLevel: analysis.riskLevel,
      },
      createdBy: req.user.id,
    })
    await sealPendingBlock()

    return review.lastInsertRowid
  })()

  res.status(201).json({ reviewId, status: 'PENDING', aiRiskLevel: analysis.riskLevel })
})

// Scanned copy of the certificate (optional PDF, up to 10 MB), attached while the officer has not decided yet.
async function ownReview(req) {
  return await db.prepare(`
    SELECT r.*, b.batch_code FROM lab_reviews r JOIN batches b ON b.id = r.batch_id
    WHERE r.id = ? AND r.org_id = ?
  `).get(Number(req.params.id), req.org.id)
}

router.put('/lab-reviews/:id/document', pdfBody, async (req, res) => {
  const review = await ownReview(req)
  if (!review) return res.status(404).json({ message: 'Lab result not found' })

  const saved = await saveDocument({
    review, buffer: req.body, fileName: decodeURIComponent(String(req.get('x-file-name') || '')),
    userId: req.user.id, orgCode: req.org.organization_code,
  })
  if (saved.error) return res.status(saved.status).json({ message: saved.error })

  res.status(201).json({ name: saved.name, size: saved.size, sha256: saved.sha256 })
})

router.get('/lab-reviews/:id/document', async (req, res) => {
  const review = await ownReview(req)
  if (!review) return res.status(404).json({ message: 'Lab result not found' })
  return sendDocument(res, review)
})

// ------------------------------------------------------------ supply chain
router.post('/transfers', async (req, res) => {
  const batch = await getBatch(req.body.batchCode)

  if (!batch || batch.org_id !== req.org.id) {
    return res.status(404).json({ message: 'Batch not found in your organisation' })
  }

  if (!(await packagingStatus(batch)).unlocked) {
    return res.status(403).json({
      code: 'PACKAGING_LOCKED',
      message: 'Honey can only move down the supply chain after its laboratory certificate is verified by your regional officer.',
    })
  }

  if (!DISTRIBUTOR_TYPES.includes(req.body.toPartyType)) {
    return res.status(400).json({ message: 'Transfer to a distributor / wholesaler or a retailer' })
  }

  try {
    const eventId = await recordTransfer({
      batch,
      actorType: 'KEEPER',
      actorId: req.user.id,
      fromPartyType: 'APICTECH',
      fromPartyId: 'APICTECH',
      toPartyType: req.body.toPartyType,
      toPartyId: req.body.toPartyName || req.body.toPartyId,
      quantityKg: req.body.quantityKg,
      metadata: { invoiceNumber: String(req.body.invoiceNumber || '').slice(0, 40) || undefined },
      createdBy: req.user.id,
    })

    res.status(201).json({ eventId })
  } catch (error) {
    if (error instanceof TransferError) return res.status(error.status).json({ message: error.message })
    throw error
  }
})

// -------------------------------------------------------------- AI insights
router.get('/insights', async (req, res) => {
  const privateDb = await companyDb(req)

  res.json(buildInsights({
    finance: await privateDb.prepare('SELECT * FROM finance_entries').all(),
    harvests: await privateDb.prepare('SELECT * FROM harvests').all(),
  }))
})

// ------------------------------------------------------------ notifications
// Decisions made by officers about this company, newest first.
async function listNotifications(req, res) {
  const items = []

  if (req.org.reviewed_at) {
    items.push({
      id: `org-${req.org.status}`,
      type: 'organization',
      title: {
        APPROVED: 'Organisation accepted into the KVIC chain',
        REJECTED: 'Organisation registration was not accepted',
        SUSPENDED: 'Organisation suspended from the KVIC chain',
      }[req.org.status] || 'Organisation status updated',
      message: req.org.review_note || 'No note was left by the officer.',
      time: req.org.reviewed_at,
    })
  }

  const reviews = await db.prepare(`
    SELECT r.id, r.status, r.review_note, r.reviewed_at, b.batch_code, t.lab_name
    FROM lab_reviews r
    JOIN batches b ON b.id = r.batch_id
    JOIN laboratory_tests t ON t.id = r.lab_test_id
    WHERE r.org_id = ? AND r.status != 'PENDING'
    ORDER BY r.reviewed_at DESC LIMIT 20
  `).all(req.org.id)

  for (const review of reviews) {
    items.push({
      id: `lab-${review.id}`,
      type: 'lab',
      title: review.status === 'VERIFIED'
        ? `Lab result verified for ${review.batch_code}`
        : `Lab result rejected for ${review.batch_code}`,
      message: review.review_note || `Report from ${review.lab_name} was reviewed by your regional officer.`,
      time: review.reviewed_at,
    })
  }

  // Shop orders that wait for the keeper: new, payment sent by the buyer, or paid and ready to ship.
  const waiting = await (await getCompanyDb(req.org.organization_code)).prepare("SELECT order_code, product_title, quantity, payment_status, created_at, updated_at FROM shop_orders WHERE order_status = 'PLACED' ORDER BY id DESC LIMIT 10").all()
  for (const order of waiting) {
    items.push({
      id: `order-${order.order_code}-${order.payment_status}`,
      type: 'order',
      title: order.payment_status === 'CLAIMED' ? `Confirm the payment for order ${order.order_code}` : order.payment_status === 'PAID' ? `Order ${order.order_code} is paid: ship it` : `New order ${order.order_code}`,
      message: `${order.quantity} x ${order.product_title}. Open Orders to act on it.`,
      time: order.updated_at || order.created_at,
    })
  }

  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA')

  for (const inspection of await keeperInspections(req.org.id)) {
    const when = `${inspection.scheduledDate}${inspection.scheduledTime ? ` at ${inspection.scheduledTime}` : ''}`

    if (inspection.status === 'SCHEDULED') {
      items.push({
        id: `inspection-${inspection.id}`,
        type: 'inspection',
        title: `Inspection notice ${inspection.code}: ${when}`,
        message: `${inspection.purposeLabel}. ${inspection.instructions || 'Keep your licences, batch records and stock ready for the officer.'}`,
        time: inspection.noticeAt,
      })

      if (inspection.scheduledDate <= tomorrow) {
        items.push({
          id: `inspection-reminder-${inspection.id}`,
          type: 'inspection',
          title: inspection.scheduledDate === tomorrow ? `Reminder: inspection tomorrow (${when})` : `Inspection today (${when})`,
          message: 'Keep your FSSAI licence, batch and sales records and honey stock ready.',
          time: new Date().toISOString(),
        })
      }
    } else if (inspection.status === 'COMPLETED') {
      items.push({
        id: `inspection-done-${inspection.id}`,
        type: 'inspection',
        title: `Inspection ${inspection.code} graded ${inspection.grade} (${inspection.gradeLabel})`,
        message: `${inspection.outcomeLabel}. ${inspection.remarks}`,
        time: inspection.reportedAt,
      })
    } else if (inspection.status === 'CANCELLED') {
      items.push({
        id: `inspection-cancel-${inspection.id}`,
        type: 'inspection',
        title: `Inspection ${inspection.code} was cancelled`,
        message: inspection.cancelReason || 'The scheduled visit will not take place.',
        time: inspection.noticeAt,
      })
    }
  }

  for (const notice of await visibleAnnouncements(keeperViewer(req), { limit: 15 })) {
    items.push({
      id: `notice-${notice.id}`,
      type: 'announcement',
      title: `${notice.priority === 'URGENT' ? 'Urgent: ' : ''}${notice.title}`,
      message: `${notice.from}: ${notice.body}`,
      time: notice.createdAt,
    })
  }

  items.push(...await keeperTicketNotices(req.org))

  const closure = await getOpenClosure(req.org.id)
  if (closure && closure.initiated_by_role !== 'BEEKEEPER') {
    items.push({
      id: `closure-${closure.id}`,
      type: 'organization',
      title: 'Closure notice from your KVIC officer',
      message: closure.reason,
      time: closure.created_at,
    })
  }

  items.sort((a, b) => String(b.time).localeCompare(String(a.time)))
  res.json(items)
}

export default router
