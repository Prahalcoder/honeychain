import db from '../database/database.js'
import { sealPendingBlock } from './blockchain.js'
import { lockNamed } from './ledgerLock.js'
import { batchCapacity } from './batches.js'
import { TransferError, recordTransfer } from './custody.js'
import { appendTraceabilityEvent } from './traceabilityLog.js'
import { syncMonthlyReport } from './reports.js'
import { onLooseSale } from './chain.js'

// One loose-honey sale (kg or grams, at a price per kg) to a buyer in the keeper's own Buyers list: the bill in
// Billing, the income in Finance if paid now, the kilograms taken out of the batch, and the hand-over sealed on
// the chain. Used by the keeper's Supply Chain page and when a keeper accepts a registered wholesaler's offer.
export class SaleError extends Error {
  constructor(message, status = 400, code) {
    super(message)
    this.status = status
    this.code = code
  }
}

export const MIN_GRAMS = 50
const today = () => new Date().toLocaleDateString('en-CA')
const round2 = (value) => Math.round(value * 100) / 100
const clean = (value, max) => String(value ?? '').trim().slice(0, max)
const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && !Number.isNaN(Date.parse(value))

// The buyer's type decides which link of the public supply chain the hand-over is.
const PARTY_FOR = { Wholesaler: 'WHOLESALER', Company: 'WHOLESALER', Retailer: 'RETAILER', 'Direct Consumer': null }
const PARTY_LABEL = { WHOLESALER: 'Wholesaler', RETAILER: 'Retailer' }

async function nextCode(db2, table, prefix, column) {
  const key = `${prefix}-${new Date().getFullYear()}-`
  const highest = (await db2.prepare(`SELECT ${column} AS code FROM ${table} WHERE ${column} LIKE ?`).all(`${key}%`))
    .reduce((max, row) => Math.max(max, Number(row.code.slice(key.length)) || 0), 0)
  return `${key}${String(highest + 1).padStart(3, '0')}`
}

export async function createLooseSale({ org, user, privateDb, buyer, batch, grams, pricePerKg, gstPercent = 0, saleDate = today(), paid = false, publicName = true, note = '', extraMetadata = {} }) {
  if (!Number.isFinite(grams) || grams < MIN_GRAMS) throw new SaleError(`Enter the quantity sold (at least ${MIN_GRAMS} g)`)
  if (!Number.isFinite(pricePerKg) || pricePerKg <= 0 || pricePerKg > 100000) throw new SaleError('Enter the agreed price per kg')
  if (!(gstPercent >= 0 && gstPercent <= 28)) throw new SaleError('GST must be between 0 and 28 percent')
  if (!isDate(saleDate) || saleDate > today() || saleDate < batch.harvest_date) throw new SaleError('The sale date must be between the harvest date and today')

  const capacity = await batchCapacity(batch)
  if (grams > capacity.remainingGrams) {
    throw new SaleError(
      `Only ${round2(capacity.remainingGrams / 1000)} kg of ${batch.batch_code} is left to sell. ${round2(capacity.packedGrams / 1000)} kg is reserved for QR jars and ${round2(capacity.looseGrams / 1000)} kg was already sold loose.`,
      409, 'NOT_ENOUGH_HONEY',
    )
  }

  const kg = grams / 1000
  const amount = round2(kg * pricePerKg)
  const gst = round2((amount * gstPercent) / 100)
  const party = PARTY_FOR[buyer.type] ?? null
  const partyId = party ? (publicName ? buyer.name : `${PARTY_LABEL[party]} (name withheld)`) : null

  let created
  try {
    created = await privateDb.transaction(async () => {
      await lockNamed(`sale:${org.id}`)

      // The honey check above ran before the lock; run it again so two requests cannot both take the last honey.
      await lockNamed(`honey:${batch.id}`)
      const fresh = await batchCapacity(batch)
      if (grams > fresh.remainingGrams) throw new TransferError(`Only ${round2(fresh.remainingGrams / 1000)} kg of ${batch.batch_code} is left to sell.`, 409)

      const code = await nextCode(privateDb, 'honey_sales', 'SAL', 'sale_code')
      const invoiceNumber = await nextCode(privateDb, 'invoices', 'INV', 'invoice_number')
      const description = `Loose honey ${batch.honey_type}, batch ${batch.batch_code} (${kg} kg at ₹${pricePerKg}/kg)`

      const invoiceId = (await privateDb.prepare(`
        INSERT INTO invoices (invoice_number, buyer_id, batch_code, issue_date, lines_json, subtotal_inr, gst_percent, gst_inr, total_inr, status, paid_at, finance_entry_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', NULL, NULL)
      `).run(invoiceNumber, buyer.id, batch.batch_code, saleDate, JSON.stringify([{ description, quantity: kg, unitPrice: pricePerKg }]),
        amount, gstPercent, gst, round2(amount + gst))).lastInsertRowid

      if (paid) {
        const entryId = (await privateDb.prepare(`
          INSERT INTO finance_entries (entry_date, type, category, description, amount_inr) VALUES (?, 'INCOME', 'Sales income', ?, ?)
        `).run(today(), `Invoice ${invoiceNumber} · ${buyer.name}${gst > 0 ? ` (GST Rs ${gst} collected, not counted as income)` : ''}`, amount)).lastInsertRowid
        await privateDb.prepare("UPDATE invoices SET status = 'Paid', paid_at = ?, finance_entry_id = ? WHERE id = ?").run(new Date().toISOString(), entryId, invoiceId)
      }

      const id = (await privateDb.prepare(`
        INSERT INTO honey_sales (sale_code, buyer_id, batch_code, quantity_grams, price_per_kg, amount_inr, sale_date, invoice_id, note, public_name, party_type, party_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(code, buyer.id, batch.batch_code, grams, pricePerKg, amount, saleDate, invoiceId, clean(note, 200), publicName ? 1 : 0, party, partyId)).lastInsertRowid

      await db.prepare('INSERT INTO loose_sales (sale_code, org_id, batch_id, grams, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(code, org.id, batch.id, grams, new Date().toISOString())

      if (party) {
        await recordTransfer({
          batch, actorType: 'KEEPER', actorId: user.id, toPartyType: party, toPartyId: partyId, quantityKg: kg,
          metadata: { sale: 'LOOSE', saleCode: code, grams, ...extraMetadata }, createdBy: user.id,
        })
      } else {
        await appendTraceabilityEvent({
          entityType: 'BATCH', entityId: batch.batch_code, eventType: 'DIRECT_SALE_RECORDED',
          payload: { saleCode: code, quantityKg: kg, sale: 'LOOSE' }, createdBy: user.id,
        })
        await sealPendingBlock()
      }

      return { id, code, invoiceNumber, amountInr: amount, totalInr: round2(amount + gst) }
    })()
  } catch (error) {
    if (error instanceof TransferError) throw new SaleError(error.message, error.status)
    throw error
  }

  if (paid) await syncMonthlyReport(org)
  await onLooseSale({ userId: user.id, organizationCode: org.organization_code, saleCode: created.code, batchCode: batch.batch_code, grams, buyerLabel: partyId || 'direct-consumer' })
  return created
}
