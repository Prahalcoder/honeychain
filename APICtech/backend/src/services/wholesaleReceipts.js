import db from '../database/database.js'
import { nextCode } from './codes.js'
import { batchCapacity, getBatch } from './batches.js'
import { getCompanyDb } from './companyDb.js'
import { minPerKg } from './pricing.js'
import { SaleError, createLooseSale } from './looseSales.js'
import { buyerFor } from './trade.js'
import { OtpError, deliverOtp, issueOtp, verifyOtp } from './otp.js'
import { indianMobile, sendSms } from './sms.js'
import { appendTraceabilityEvent } from './traceabilityLog.js'
import { sealPendingBlock } from './blockchain.js'
import { TRADER_TYPE } from '../config/registration.js'
import { ALL_HONEY_TYPES } from '../config/honeyCatalogue.js'

// Honey a wholesaler RECEIVED from a beekeeper, recorded from the wholesaler's side — for when the keeper forgot
// (or never learnt) to record the sale. The wholesaler enters the keeper's registered mobile number and name;
// the keeper gets an OTP by SMS and gives it to the wholesaler only if the receipt is true. Once confirmed:
//  - if the keeper's harvest is on record, the sale is booked in the keeper's books exactly like a loose sale
//    (bill, kilograms out of the batch) and the hand-over goes on the chain, marked "initiated by the wholesaler,
//    confirmed by the keeper's OTP";
//  - if not, the receipt waits (AWAITING_HARVEST) until the keeper records the harvest and attaches it — the
//    keeper's stock can only go down from honey that was actually recorded as harvested.
export class ReceiptError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

const text = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const today = () => new Date().toLocaleDateString('en-CA')
const round2 = (value) => Math.round(value * 100) / 100
const words = (value) => String(value || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3)

// The entered name must share a word (3+ letters) with the keeper's registered name or farm name.
function nameMatches(entered, ...candidates) {
  const given = words(entered)
  const known = new Set(candidates.flatMap(words))
  return given.length > 0 && given.some((w) => known.has(w))
}

async function keeperByMobile(mobile) {
  return await db.prepare(`
    SELECT o.*, u.name AS owner_name, u.id AS owner_id, s.phone AS owner_phone
    FROM organizations o JOIN users u ON u.id = o.owner_user_id LEFT JOIN user_settings s ON s.user_id = u.id
    WHERE o.status = 'APPROVED' AND o.organization_type <> ? AND u.role = 'BEEKEEPER'
  `).all(TRADER_TYPE).then((rows) => rows.filter((row) => indianMobile(row.owner_phone) === mobile))
}

// ------------------------------------------------------------------ wholesaler side
export async function startReceipt(traderOrg, traderUser, input = {}) {
  const mobile = indianMobile(input.keeperPhone)
  if (!mobile) throw new ReceiptError("Enter the beekeeper's 10-digit registered mobile number")
  const keeperName = text(input.keeperName, 80)
  if (keeperName.length < 3) throw new ReceiptError("Enter the beekeeper's name")
  const quantity = Number(input.quantityKg)
  const price = Number(input.pricePerKg)
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > 100000) throw new ReceiptError('Enter the kilograms received (at least 1 kg)')
  if (!Number.isFinite(price) || price <= 0 || price > 100000) throw new ReceiptError('Enter the price per kg paid or agreed')
  const received = text(input.receivedDate, 10) || today()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(received) || received > today()) throw new ReceiptError('The date received must be today or earlier')
  if (Date.now() - Date.parse(`${received}T00:00:00`) > 90 * 86400000) throw new ReceiptError('Record receipts within 90 days')

  const candidates = await keeperByMobile(mobile)
  const keeper = candidates.find((row) => nameMatches(keeperName, row.owner_name, row.legal_name))
  if (!candidates.length) throw new ReceiptError('No KVIC-approved beekeeper is registered with this mobile number', 404)
  if (!keeper) throw new ReceiptError('The name does not match the beekeeper registered with this mobile number')
  if (keeper.id === traderOrg.id) throw new ReceiptError('You cannot record honey from your own company')

  let batch = null
  if (text(input.batchCode, 40)) {
    batch = await getBatch(text(input.batchCode, 40))
    if (!batch || batch.org_id !== keeper.id) throw new ReceiptError("That batch number is not one of this beekeeper's batches")
  }
  const honeyType = batch ? batch.honey_type : text(input.honeyType, 60)
  if (!ALL_HONEY_TYPES.includes(honeyType)) throw new ReceiptError('Choose the honey type')
  const floor = await minPerKg(honeyType)
  if (price < floor) throw new ReceiptError(`KVIC's minimum for ${honeyType} is Rs ${floor} per kg. A receipt below it cannot be recorded.`)

  const code = nextCode('RCV')
  await db.transaction(async () => {
    // A receipt still waiting for the same keeper's OTP is replaced by the new one.
    await db.prepare("UPDATE wholesale_receipts SET status = 'CANCELLED' WHERE trader_org_id = ? AND keeper_org_id = ? AND status = 'OTP_SENT'").run(traderOrg.id, keeper.id)
    await db.prepare(`
      INSERT INTO wholesale_receipts (receipt_code, trader_org_id, keeper_org_id, keeper_name_entered, honey_type, quantity_kg, price_per_kg, received_date, note, batch_id, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(code, traderOrg.id, keeper.id, keeperName, honeyType, round2(quantity), round2(price), received, text(input.note, 300) || null, batch?.id ?? null, traderUser.id, new Date().toISOString())
  })()

  try {
    const otp = await issueOtp({ purpose: 'RECEIPT', subjectKey: code, meta: { keeperOrgId: keeper.id } })
    const delivery = await deliverOtp({
      to: mobile, code: otp,
      text: `Honey Chain: ${traderOrg.legal_name} (wholesaler) is recording that they received ${round2(quantity)} kg of ${honeyType} from you at Rs ${round2(price)}/kg on ${received}. If this is correct, tell them this OTP: ${otp}. Otherwise do not share it.`,
    })
    return { code, keeper: { name: keeper.legal_name, region: keeper.region, state: keeper.state }, otp: delivery }
  } catch (error) {
    await db.prepare("UPDATE wholesale_receipts SET status = 'CANCELLED' WHERE receipt_code = ?").run(code)
    if (error instanceof OtpError) throw new ReceiptError(error.message, error.status)
    throw error
  }
}

export async function resendReceiptOtp(traderOrg, code) {
  const receipt = await db.prepare("SELECT * FROM wholesale_receipts WHERE receipt_code = ? AND trader_org_id = ? AND status = 'OTP_SENT'").get(text(code, 40), traderOrg.id)
  if (!receipt) throw new ReceiptError('This receipt is not waiting for an OTP', 404)
  const keeper = await db.prepare('SELECT s.phone FROM organizations o JOIN user_settings s ON s.user_id = o.owner_user_id WHERE o.id = ?').get(receipt.keeper_org_id)
  try {
    const otp = await issueOtp({ purpose: 'RECEIPT', subjectKey: receipt.receipt_code, meta: { keeperOrgId: receipt.keeper_org_id } })
    return await deliverOtp({
      to: indianMobile(keeper?.phone), code: otp,
      text: `Honey Chain: ${traderOrg.legal_name} (wholesaler) is recording that they received ${receipt.quantity_kg} kg of ${receipt.honey_type} from you. If this is correct, tell them this OTP: ${otp}. Otherwise do not share it.`,
    })
  } catch (error) {
    if (error instanceof OtpError) throw new ReceiptError(error.message, error.status)
    throw error
  }
}

export async function confirmReceipt(traderOrg, code, otp) {
  const receipt = await db.prepare('SELECT * FROM wholesale_receipts WHERE receipt_code = ? AND trader_org_id = ?').get(text(code, 40), traderOrg.id)
  if (!receipt) throw new ReceiptError('Receipt not found', 404)
  if (receipt.status !== 'OTP_SENT') throw new ReceiptError(`This receipt is already ${receipt.status.toLowerCase().replace('_', ' ')}`, 409)
  try {
    await verifyOtp({ purpose: 'RECEIPT', subjectKey: receipt.receipt_code, code: otp })
  } catch (error) {
    if (error instanceof OtpError) throw new ReceiptError(error.message, error.status)
    throw error
  }
  const claimed = await db.prepare("UPDATE wholesale_receipts SET status = 'CONFIRMED', confirmed_at = ? WHERE id = ? AND status = 'OTP_SENT'").run(new Date().toISOString(), receipt.id)
  if (!claimed.changes) throw new ReceiptError('This receipt was just confirmed', 409)

  const keeper = await db.prepare('SELECT * FROM organizations WHERE id = ?').get(receipt.keeper_org_id)
  // The confirmation itself goes on the ledger straight away, even before a batch is attached: who initiated it
  // (the wholesaler) and how the keeper agreed (OTP). Only identifiers and quantities, no names or numbers.
  await appendTraceabilityEvent({
    entityType: 'RECEIPT', entityId: receipt.receipt_code, eventType: 'WHOLESALER_RECEIPT_CONFIRMED',
    payload: {
      receiptCode: receipt.receipt_code, initiatedBy: 'WHOLESALER', confirmedBy: 'KEEPER_OTP',
      traderOrganization: traderOrg.organization_code, keeperOrganization: keeper.organization_code,
      honeyType: receipt.honey_type, quantityKg: Number(receipt.quantity_kg), receivedDate: receipt.received_date,
    },
    createdBy: receipt.created_by,
  })
  await sealPendingBlock()
  return await completeReceipt(receipt.id)
}

export async function cancelReceipt(traderOrg, code) {
  const result = await db.prepare("UPDATE wholesale_receipts SET status = 'CANCELLED' WHERE receipt_code = ? AND trader_org_id = ? AND status = 'OTP_SENT'").run(text(code, 40), traderOrg.id)
  if (!result.changes) throw new ReceiptError('Only a receipt still waiting for the OTP can be withdrawn', 409)
}

// ------------------------------------------------------------------ completing (booking the sale)
async function candidateBatch(receipt, grams) {
  const batches = await db.prepare(`
    SELECT * FROM batches WHERE org_id = ? AND honey_type = ? AND harvest_date <= ? ORDER BY harvest_date ASC, id ASC
  `).all(receipt.keeper_org_id, receipt.honey_type, receipt.received_date)
  for (const batch of batches) {
    if ((await batchCapacity(batch)).remainingGrams >= grams) return batch
  }
  return null
}

// Books the confirmed receipt as a sale in the keeper's books, from the given batch or the oldest batch of that
// honey with enough left. Without one, the receipt waits for the keeper to record the harvest.
async function completeReceipt(receiptId, { batch: chosen = null, actor = null } = {}) {
  const before = await db.prepare('SELECT status FROM wholesale_receipts WHERE id = ?').get(receiptId)
  // Claim the receipt first, so two clicks (or two devices) can never book it twice.
  const claimed = await db.prepare("UPDATE wholesale_receipts SET status = 'COMPLETING' WHERE id = ? AND status IN ('CONFIRMED', 'AWAITING_HARVEST')").run(receiptId)
  if (!claimed.changes) throw new ReceiptError(`This receipt is already ${String(before?.status || '').toLowerCase().replace('_', ' ')}`, 409)
  const release = async (status) => db.prepare("UPDATE wholesale_receipts SET status = ? WHERE id = ? AND status = 'COMPLETING'").run(status, receiptId)

  try {
    const receipt = await db.prepare('SELECT * FROM wholesale_receipts WHERE id = ?').get(receiptId)
    const grams = Math.round(Number(receipt.quantity_kg) * 1000)
    const keeper = await db.prepare('SELECT * FROM organizations WHERE id = ?').get(receipt.keeper_org_id)
    const trader = await db.prepare('SELECT * FROM organizations WHERE id = ?').get(receipt.trader_org_id)
    const owner = await db.prepare('SELECT u.*, s.phone FROM users u LEFT JOIN user_settings s ON s.user_id = u.id WHERE u.id = ?').get(keeper.owner_user_id)

    let batch = chosen || (receipt.batch_id ? await db.prepare('SELECT * FROM batches WHERE id = ?').get(receipt.batch_id) : null)
    if (batch && (await batchCapacity(batch)).remainingGrams < grams) {
      if (chosen) throw new ReceiptError(`Only ${round2((await batchCapacity(batch)).remainingGrams / 1000)} kg of ${batch.batch_code} is left, less than the ${receipt.quantity_kg} kg received`, 409)
      batch = null
    }
    if (!batch) batch = await candidateBatch(receipt, grams)

    if (!batch) {
      await release('AWAITING_HARVEST')
      if (before.status !== 'AWAITING_HARVEST') {
        const mobile = indianMobile(owner?.phone)
        if (mobile) {
          await sendSms(mobile, `Honey Chain: you confirmed that ${trader.legal_name} received ${receipt.quantity_kg} kg of ${receipt.honey_type} from you (receipt ${receipt.receipt_code}). Record that harvest in Honey Chain Keeper and attach it under Supply Chain > Wholesale offers to complete it.`)
        }
      }
      return { code: receipt.receipt_code, status: 'AWAITING_HARVEST' }
    }

    const saleDate = receipt.received_date < batch.harvest_date ? batch.harvest_date : receipt.received_date
    const privateDb = await getCompanyDb(keeper.organization_code)
    const phone = (await db.prepare('SELECT phone FROM user_settings WHERE user_id = ?').get(trader.owner_user_id))?.phone || ''
    const sale = await createLooseSale({
      org: keeper, user: actor || owner, privateDb, buyer: await buyerFor(privateDb, trader, phone), batch, grams,
      pricePerKg: Number(receipt.price_per_kg), saleDate, paid: false, publicName: true,
      note: `Recorded by wholesaler ${trader.legal_name} (receipt ${receipt.receipt_code}), confirmed by your OTP`,
      extraMetadata: { initiatedBy: 'WHOLESALER', confirmedBy: 'KEEPER_OTP', receiptCode: receipt.receipt_code, traderOrganization: trader.organization_code },
    })
    await db.prepare("UPDATE wholesale_receipts SET status = 'COMPLETED', batch_id = ?, sale_code = ?, invoice_number = ?, completed_at = ? WHERE id = ?")
      .run(batch.id, sale.code, sale.invoiceNumber, new Date().toISOString(), receiptId)
    return { code: receipt.receipt_code, status: 'COMPLETED', batchCode: batch.batch_code, saleCode: sale.code, invoiceNumber: sale.invoiceNumber }
  } catch (error) {
    await release(before.status === 'CONFIRMED' ? 'AWAITING_HARVEST' : before.status)
    if (error instanceof SaleError) throw new ReceiptError(error.message, error.status)
    throw error
  }
}

// ------------------------------------------------------------------ keeper side
export async function attachReceipt(keeperOrg, user, code, batchCode) {
  const receipt = await db.prepare('SELECT * FROM wholesale_receipts WHERE receipt_code = ? AND keeper_org_id = ?').get(text(code, 40), keeperOrg.id)
  if (!receipt) throw new ReceiptError('Receipt not found', 404)
  if (receipt.status !== 'AWAITING_HARVEST') throw new ReceiptError('Only a receipt waiting for its harvest can be attached', 409)
  const batch = await getBatch(text(batchCode, 40))
  if (!batch || batch.org_id !== keeperOrg.id) throw new ReceiptError('Choose one of your batches', 404)
  if (batch.honey_type !== receipt.honey_type) throw new ReceiptError(`This receipt is for ${receipt.honey_type}; the batch is ${batch.honey_type}`)
  if (batch.harvest_date > receipt.received_date) throw new ReceiptError(`The wholesaler received the honey on ${receipt.received_date}, before this batch was harvested (${batch.harvest_date}). Record the harvest with its real date.`)
  return await completeReceipt(receipt.id, { batch, actor: user })
}

function view(row, side) {
  return {
    code: row.receipt_code, status: row.status, honeyType: row.honey_type, quantityKg: Number(row.quantity_kg),
    pricePerKg: Number(row.price_per_kg), totalInr: round2(Number(row.quantity_kg) * Number(row.price_per_kg)),
    receivedDate: row.received_date, note: row.note, batchCode: row.batch_code || null, saleCode: row.sale_code,
    invoiceNumber: row.invoice_number, createdAt: row.created_at, confirmedAt: row.confirmed_at, completedAt: row.completed_at,
    ...(side === 'TRADER'
      ? { keeper: { name: row.other_name, region: row.other_region, state: row.other_state, nameEntered: row.keeper_name_entered } }
      : { trader: { name: row.other_name, region: row.other_region, state: row.other_state, gstin: row.other_gstin } }),
  }
}

export async function traderReceipts(traderOrgId) {
  return (await db.prepare(`
    SELECT r.*, b.batch_code, o.legal_name AS other_name, o.region AS other_region, o.state AS other_state
    FROM wholesale_receipts r JOIN organizations o ON o.id = r.keeper_org_id LEFT JOIN batches b ON b.id = r.batch_id
    WHERE r.trader_org_id = ? ORDER BY r.id DESC LIMIT 200
  `).all(traderOrgId)).map((row) => view(row, 'TRADER'))
}

export async function keeperReceipts(keeperOrgId) {
  return (await db.prepare(`
    SELECT r.*, b.batch_code, o.legal_name AS other_name, o.region AS other_region, o.state AS other_state, o.gstin AS other_gstin
    FROM wholesale_receipts r JOIN organizations o ON o.id = r.trader_org_id LEFT JOIN batches b ON b.id = r.batch_id
    WHERE r.keeper_org_id = ? AND r.status IN ('AWAITING_HARVEST', 'COMPLETED') ORDER BY (r.status = 'AWAITING_HARVEST') DESC, r.id DESC LIMIT 200
  `).all(keeperOrgId)).map((row) => view(row, 'KEEPER'))
}

