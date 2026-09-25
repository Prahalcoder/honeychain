import crypto from 'node:crypto'

import db from '../database/database.js'
import { REGIONS } from '../config/regions.js'
import { formatAddress } from '../config/sampleData.js'
import { getCompanyDb } from './companyDb.js'
import { JarError, lotStock, pickJarIds, returnJars, takeJars } from './jars.js'
import { batchCapacity, packagingStatus } from './batches.js'
import { getGstPercent, minPerJar, minPerKg, withGst } from './pricing.js'
import { syncMonthlyReport } from './reports.js'
import { sendMail } from './mailer.js'
import { lanAddress } from '../config/network.js'
import { lockNamed } from './ledgerLock.js'
import { specialtiesFor } from '../config/honeyCatalogue.js'

// The public shop ("Sellers nearby"): approved keepers list packed honey, buyers order without an account,
// pay the seller by UPI, and follow the parcel. Products, prices and stock are public. Buyer details and the
// orders themselves sit in the seller's private schema (shop_orders); only the order code and the seller are
// in the common database (shop_order_index) so the tracking page can find an order.
export class ShopError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

export const PAYMENT = { PENDING: 'PENDING', CLAIMED: 'CLAIMED', PAID: 'PAID' }
export const STATUS = { PLACED: 'PLACED', SHIPPED: 'SHIPPED', DELIVERED: 'DELIVERED', CANCELLED: 'CANCELLED' }

const now = () => new Date().toISOString()
const today = () => new Date().toLocaleDateString('en-CA')
const round2 = (value) => Math.round(value * 100) / 100

// An order nobody pays for is cancelled after this many hours and its jars go back on the shelf.
const HOLD_HOURS = Number(process.env.SHOP_HOLD_HOURS || 24)
const payByOf = (order) => new Date(Date.parse(order.created_at) + HOLD_HOURS * 3600 * 1000).toISOString()
const text = (value, max) => String(value ?? '').trim().slice(0, max)
const PHONE = /^[6-9]\d{9}$/
const PIN = /^\d{6}$/
const UPI = /^[a-zA-Z0-9._-]{2,}@[a-zA-Z0-9]{2,}$/

export const validUpi = (value) => UPI.test(String(value || ''))

const ownerPhone = async (org) => (await db.prepare('SELECT phone FROM user_settings WHERE user_id = ?').get(org.owner_user_id))?.phone || ''

// A buyer who ordered from Sellers nearby is matched (or created) by phone number as a "Direct Consumer" — the
// same buyer type a keeper would pick for a walk-in sale — so their purchase history reads the same way either way.
async function findOrCreateBuyer(privateDb, { name, phone, address }) {
  const existing = phone && await privateDb.prepare("SELECT * FROM buyers WHERE contact = ? AND type = 'Direct Consumer'").get(phone)
  if (existing) return existing
  const created = await privateDb.prepare("INSERT INTO buyers (name, type, contact, address) VALUES (?, 'Direct Consumer', ?, ?)")
    .run(text(name, 80), phone, text(address, 300))
  return await privateDb.prepare('SELECT * FROM buyers WHERE id = ?').get(created.lastInsertRowid)
}

async function nextInvoiceNumber(privateDb) {
  const key = `INV-${new Date().getFullYear()}-`
  const highest = (await privateDb.prepare('SELECT invoice_number AS code FROM invoices WHERE invoice_number LIKE ?').all(`${key}%`))
    .reduce((max, row) => Math.max(max, Number(row.code.slice(key.length)) || 0), 0)
  return `${key}${String(highest + 1).padStart(3, '0')}`
}

// Auto-fills a Billing invoice for a Sellers-nearby order the moment it is placed (status Pending), so it shows
// up as a proper bill straight away instead of only as a shop order. setPayment/release keep its status, paid_at
// and finance_entry_id in step afterwards — this never creates a second finance entry of its own.
async function createOrderInvoice(org, privateDb, { orderCode, title, quantity, unitPrice, gstPercent, gstInr, totalInr, packBatchCode, batchCode, buyerName, buyerPhone, buyerAddress, issueDate }) {
  const buyer = await findOrCreateBuyer(privateDb, { name: buyerName, phone: buyerPhone, address: buyerAddress })
  await lockNamed(`invoice:${org.id}`)
  const number = await nextInvoiceNumber(privateDb)
  const line = { description: title, quantity, unitPrice, ...(packBatchCode ? { packBatchCode } : {}) }

  const created = await privateDb.prepare(`
    INSERT INTO invoices (invoice_number, buyer_id, batch_code, issue_date, lines_json, subtotal_inr, gst_percent, gst_inr, total_inr, source, order_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PORTAL', ?)
  `).run(number, buyer.id, batchCode || null, issueDate || today(), JSON.stringify([line]), round2(quantity * unitPrice), gstPercent, gstInr, totalInr, orderCode)

  await privateDb.prepare('UPDATE shop_orders SET invoice_id = ? WHERE order_code = ?').run(created.lastInsertRowid, orderCode)
  return created.lastInsertRowid
}

// The seller's address as shown to buyers.
const orgAddress = (org) => ({
  line: org.address_line || '',
  locality: org.locality || '',
  district: org.district || '',
  state: org.state || '',
  pincode: org.pincode || '',
  text: formatAddress({ addressLine: org.address_line, locality: org.locality, district: org.district, state: org.state, pincode: org.pincode }),
})

// ---------------------------------------------------------------- browsing
// Every state with its registered farms per region. Approved farms are listed even when they have nothing on sale
// yet; `withStock` counts the ones that have jars to order today.
export async function browseStates() {
  const rows = await db.prepare(`
    SELECT o.state, o.region, COUNT(*) AS sellers,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM shop_listings l WHERE l.org_id = o.id AND l.active = 1 AND l.stock_qty > 0) THEN 1 ELSE 0 END) AS with_stock
    FROM organizations o
    WHERE o.status = 'APPROVED'
    GROUP BY o.state, o.region
  `).all()

  const counts = new Map(rows.map((row) => [`${row.state}|${row.region}`, { sellers: Number(row.sellers), withStock: Number(row.with_stock) }]))

  return Object.entries(REGIONS).map(([state, regions]) => {
    const list = regions.map((region) => ({ region, sellers: counts.get(`${state}|${region}`)?.sellers || 0, withStock: counts.get(`${state}|${region}`)?.withStock || 0 }))
    return {
      state,
      sellers: list.reduce((sum, item) => sum + item.sellers, 0),
      withStock: list.reduce((sum, item) => sum + item.withStock, 0),
      specialties: specialtiesFor(state).map((item) => ({ type: item.type, note: item.note })),
      regions: list,
    }
  })
}

export async function browseSellers({ state = '', region = '' }) {
  const conditions = ["o.status = 'APPROVED'"]
  const params = []
  if (state) { conditions.push('o.state = ?'); params.push(state) }
  if (region) { conditions.push('o.region = ?'); params.push(region) }
  const where = conditions.join(' AND ')
  const onSale = 'l.org_id = o.id AND l.active = 1 AND l.stock_qty > 0'

  const rows = await db.prepare(`
    SELECT o.organization_code, o.legal_name, o.state, o.region, o.locality, o.district, o.pincode,
      s.phone,
      (SELECT COUNT(*) FROM shop_listings l WHERE ${onSale}) AS product_count,
      (SELECT MIN(l.price_inr) FROM shop_listings l WHERE ${onSale}) AS from_price,
      (SELECT COALESCE(SUM(l.stock_qty), 0) FROM shop_listings l WHERE ${onSale}) AS jars
    FROM organizations o
    LEFT JOIN user_settings s ON s.user_id = o.owner_user_id
    WHERE ${where}
    ORDER BY o.state, o.region, o.legal_name
  `).all(...params)

  const types = await db.prepare(`
    SELECT DISTINCT o.organization_code, b.honey_type
    FROM organizations o
    JOIN shop_listings l ON ${onSale}
    LEFT JOIN pack_batches pb ON pb.id = l.pack_batch_id
    JOIN batches b ON b.id = COALESCE(pb.batch_id, l.batch_id)
    WHERE ${where}
  `).all(...params, ...[])
  const typesBy = new Map()
  for (const row of types) typesBy.set(row.organization_code, [...(typesBy.get(row.organization_code) || []), row.honey_type])

  const gst = await getGstPercent()
  const list = rows.map((row) => ({
    code: row.organization_code, name: row.legal_name, state: row.state, region: row.region,
    place: [row.locality, row.district].filter(Boolean).join(', '), pincode: row.pincode,
    products: Number(row.product_count), fromPrice: row.from_price == null ? null : withGst(Number(row.from_price), gst), gstPercent: gst, jars: Number(row.jars), honeyTypes: typesBy.get(row.organization_code) || [],
    phone: row.phone || '',
  }))

  // Farms with something to order come first.
  return list.sort((a, b) => Number(b.products > 0) - Number(a.products > 0))
}

async function listingRows(orgId, { onlyAvailable = true } = {}) {
  return await db.prepare(`
    SELECT l.id, l.kind, l.title, l.jar_size_grams, l.price_inr, l.stock_qty, l.active, pb.pack_batch_code, b.batch_code, b.honey_type, b.harvest_date,
      (SELECT r.status FROM lab_reviews r WHERE r.batch_id = b.id ORDER BY r.id DESC LIMIT 1) AS lab_status
    FROM shop_listings l
    LEFT JOIN pack_batches pb ON pb.id = l.pack_batch_id
    JOIN batches b ON b.id = COALESCE(pb.batch_id, l.batch_id)
    WHERE l.org_id = ? ${onlyAvailable ? 'AND l.active = 1 AND l.stock_qty > 0' : ''}
    ORDER BY l.id DESC
  `).all(orgId)
}

// price is the keeper's price before GST; finalPrice is what the buyer pays; minPrice is the KVIC minimum (before GST).
// A LOOSE listing is stored as jar_size_grams = 1000 (price/stock mean "per kg"/"kg in stock"), so this view needs
// no LOOSE-specific math; packBatchCode is simply null for it (there was no packaging run).
const productView = async (row, gst) => ({
  id: row.id, kind: row.kind, title: row.title, jarSizeGrams: row.jar_size_grams, price: row.price_inr, gstPercent: gst, finalPrice: withGst(row.price_inr, gst),
  minPrice: await minPerJar(row.honey_type, row.jar_size_grams), stock: row.stock_qty, active: Boolean(row.active),
  packBatchCode: row.pack_batch_code, batchCode: row.batch_code, honeyType: row.honey_type, harvestDate: row.harvest_date,
  labVerified: row.lab_status === 'VERIFIED',
})

export async function sellerDetail(code) {
  const org = await db.prepare("SELECT * FROM organizations WHERE organization_code = ? AND status = 'APPROVED'").get(text(code, 40))
  if (!org) return null

  return {
    code: org.organization_code, name: org.legal_name, state: org.state, region: org.region,
    address: orgAddress(org), phone: await ownerPhone(org), fssai: org.fssai_license,
    gstPercent: await getGstPercent(),
    products: await Promise.all((await listingRows(org.id)).map(async (row) => await productView(row, await getGstPercent()))),
  }
}

// ---------------------------------------------------------------- buying
// One product per order. The stock is taken in the same statement that checks it, so two buyers can never
// get the last jar.
export async function placeOrder(input) {
  const code = text(input.sellerCode, 40)
  const listingId = Number(input.listingId)
  const quantity = Number(input.quantity)
  const name = text(input.buyerName, 80)
  const phone = text(input.buyerPhone, 15).replace(/\s+/g, '')
  const email = text(input.buyerEmail, 120)
  const address = text(input.deliveryAddress, 300)
  const pincode = text(input.deliveryPincode, 6)

  if (name.length < 2) throw new ShopError('Enter your name')
  if (!PHONE.test(phone)) throw new ShopError('Enter a 10-digit mobile number')
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new ShopError('The e-mail address is not valid')
  if (address.length < 10) throw new ShopError('Enter the full delivery address (house, street, town)')
  if (!PIN.test(pincode)) throw new ShopError('Enter the 6-digit PIN code')

  const org = await db.prepare("SELECT * FROM organizations WHERE organization_code = ? AND status = 'APPROVED'").get(code)
  const listing = org && await db.prepare('SELECT * FROM shop_listings WHERE id = ? AND org_id = ? AND active = 1').get(listingId, org.id)
  if (!listing) throw new ShopError('This product is no longer for sale', 404)

  // Loose honey is a coarser unit than jars, so it gets a higher (but still bounded) cap.
  const loose = listing.kind === 'LOOSE'
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > (loose ? 500 : 50)) {
    throw new ShopError(loose ? 'Choose between 1 and 500 kg' : 'Choose between 1 and 50 jars')
  }

  const privateDb = await getCompanyDb(org.organization_code)
  const orderCode = `ORD-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`

  const lot = loose ? null : await db.prepare('SELECT pb.pack_batch_code, b.batch_code FROM pack_batches pb JOIN batches b ON b.id = pb.batch_id WHERE pb.id = ?').get(listing.pack_batch_id)
  const batch = loose ? await db.prepare('SELECT * FROM batches WHERE id = ?').get(listing.batch_id) : null

  // The buyer pays the keeper's price plus the standard GST set by KVIC.
  const gstPercent = await getGstPercent()
  const baseTotal = round2(listing.price_inr * quantity)
  const gstAmount = round2((baseTotal * gstPercent) / 100)
  const total = round2(baseTotal + gstAmount)

  try {
    await db.transaction(async () => {
    if (loose) {
      // The same lock name the direct-to-wholesaler loose sale uses (routes/sales.js), so the two
      // features can never both sell honey that is no longer there.
      await lockNamed(`honey:${batch.id}`)
      const fresh = await batchCapacity(batch)
      const roomKg = Math.floor(fresh.remainingGrams / 1000)
      if (quantity > roomKg) throw new ShopError(roomKg > 0 ? `Only ${roomKg} kg of this batch is left. Please choose less.` : 'Sorry, this batch has no honey left to sell.', 409)

      await db.prepare("INSERT INTO loose_sales (sale_code, org_id, batch_id, grams, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(orderCode, org.id, batch.id, quantity * 1000, now())
      // Keeps the listing's shelf number in step with what is really left (a direct wholesale sale of the
      // same batch, taken elsewhere, does not otherwise touch this listing).
      await db.prepare('UPDATE shop_listings SET stock_qty = ?, updated_at = ? WHERE id = ?').run(roomKg - quantity, now(), listing.id)
    } else {
      await lockNamed(`jars:${listing.pack_batch_id}`)
      const taken = await db.prepare('UPDATE shop_listings SET stock_qty = stock_qty - ?, updated_at = ? WHERE id = ? AND stock_qty >= ? AND active = 1')
        .run(quantity, now(), listing.id, quantity)

      if (!taken.changes) {
        const left = (await db.prepare('SELECT stock_qty FROM shop_listings WHERE id = ?').get(listing.id)).stock_qty
        throw new ShopError(left > 0 ? `Only ${left} left. Please choose fewer jars.` : 'Sorry, this product just sold out.', 409)
      }
    }

    await privateDb.prepare(`
      INSERT INTO shop_orders
      (order_code, listing_id, kind, pack_batch_code, batch_code, product_title, jar_size_grams, quantity, unit_price_inr, total_inr, gst_percent, gst_inr,
        buyer_name, buyer_phone, buyer_email, delivery_address, delivery_pincode, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(orderCode, listing.id, listing.kind, lot?.pack_batch_code ?? null, loose ? (batch?.batch_code ?? null) : (lot?.batch_code ?? null), listing.title, listing.jar_size_grams, quantity, listing.price_inr, total, gstPercent, gstAmount,
      name, phone, email, address, pincode, now(), now())

    await db.prepare('INSERT INTO shop_order_index (order_code, org_id, listing_id) VALUES (?, ?, ?)').run(orderCode, org.id, listing.id)

    if (!loose) {
      // The jars also leave the keeper's inventory.
      await takeJars({ orgId: org.id, packBatchId: listing.pack_batch_id, quantity, channel: 'SHOP', ref: orderCode })
    }

    // A Billing invoice for this order, pre-filled, so it shows up as a proper bill right away.
    await createOrderInvoice(org, privateDb, {
      orderCode, title: listing.title, quantity, unitPrice: listing.price_inr, gstPercent, gstInr: gstAmount, totalInr: total,
      packBatchCode: loose ? null : lot?.pack_batch_code ?? null, batchCode: loose ? (batch?.batch_code ?? null) : (lot?.batch_code ?? null),
      buyerName: name, buyerPhone: phone, buyerAddress: address,
    })
    })()
  } catch (error) {
    if (error instanceof JarError) throw new ShopError('Sorry, this product just sold out.', 409)
    throw error
  }

  if (email) await sendOrderConfirmation({ email, name, orderCode, org, quantity, title: listing.title, total, kind: listing.kind })
  return orderCode
}

// The link the buyer can open at any time to see where the honey is: whether the seller has confirmed the
// payment, and whether it has shipped. Not sent for a buyer who gave no e-mail (see services/mailer.js: without
// SMTP configured this is logged and saved locally rather than actually delivered).
async function sendOrderConfirmation({ email, name, orderCode, org, quantity, title, total, kind }) {
  const base = process.env.PUBLIC_WEBSITE_URL || `http://${lanAddress() || 'localhost'}:5175`
  const link = `${base}/order/${encodeURIComponent(orderCode)}`
  const bought = kind === 'LOOSE' ? `${quantity} kg of ${title}` : `${quantity} x ${title}`
  await sendMail({
    to: email,
    subject: `Your Honey Chain order ${orderCode} is placed`,
    text: `Hello ${name},

Thank you for ordering ${bought} from ${org.legal_name}, order ${orderCode}, total Rs ${total}.

`
      + `Track it here any time, including whether the seller has received your payment and shipped the parcel:
${link}

`
      + `Pay the seller by the UPI QR code on that page, then enter the UPI reference number so they can confirm it.

Honey Chain`,
    html: `<p>Hello ${name},</p><p>Thank you for ordering <b>${bought}</b> from <b>${org.legal_name}</b>, order <b>${orderCode}</b>, total <b>Rs ${total}</b>.</p>`
      + `<p>Track it any time, including whether the seller has received your payment and shipped the parcel: <a href="${link}">${link}</a></p>`
      + `<p>Pay the seller by the UPI QR code on that page, then enter the UPI reference number so they can confirm it.</p><p>Honey Chain</p>`,
  })
}

// ---------------------------------------------------------------- one order
async function locate(orderCode) {
  const index = await db.prepare('SELECT * FROM shop_order_index WHERE order_code = ?').get(text(orderCode, 40))
  if (!index) return null

  const org = await db.prepare('SELECT * FROM organizations WHERE id = ?').get(index.org_id)
  const privateDb = await getCompanyDb(org.organization_code)
  const order = await privateDb.prepare('SELECT * FROM shop_orders WHERE order_code = ?').get(index.order_code)
  return order ? { org, privateDb, order } : null
}

// What the payment box on the order page needs. If the seller has not entered a UPI ID yet a clearly
// marked demo ID is used, so the page still shows a QR code that leads nowhere real.
function paymentFor(org, order) {
  const demo = !validUpi(org.upi_id)
  const id = demo ? `${org.organization_code.toLowerCase().replace(/[^a-z0-9]/g, '')}@honeychain` : org.upi_id
  const link = `upi://pay?pa=${encodeURIComponent(id)}&pn=${encodeURIComponent(org.legal_name)}&am=${order.total_inr.toFixed(2)}&cu=INR&tn=${encodeURIComponent(order.order_code)}`
  return { upiId: id, payee: org.legal_name, amount: order.total_inr, link, demo }
}

function timeline(order) {
  const steps = [{ key: 'PLACED', label: 'Order placed', at: order.created_at, done: true }]

  if (order.order_status === STATUS.CANCELLED) return [...steps, { key: 'CANCELLED', label: 'Order cancelled', at: order.updated_at, done: true, note: order.cancel_reason }]

  steps.push({ key: 'PAID', label: order.payment_status === PAYMENT.CLAIMED ? 'Payment sent, seller is checking' : 'Payment confirmed by the seller', at: order.paid_at, done: order.payment_status === PAYMENT.PAID })
  steps.push({ key: 'SHIPPED', label: 'Shipped', at: order.shipped_at, done: [STATUS.SHIPPED, STATUS.DELIVERED].includes(order.order_status), note: order.courier ? `${order.courier}${order.tracking_ref ? `, tracking ${order.tracking_ref}` : ''}` : '' })
  steps.push({ key: 'DELIVERED', label: 'Delivered', at: order.delivered_at, done: order.order_status === STATUS.DELIVERED })
  return steps
}

const buyerView = async ({ org, order }) => ({
  code: order.order_code, kind: order.kind,
  product: order.product_title, jarSizeGrams: order.jar_size_grams, quantity: order.quantity, unitPrice: order.unit_price_inr, gstPercent: order.gst_percent, gst: order.gst_inr, total: order.total_inr,
  paymentStatus: order.payment_status, paymentRef: order.payment_ref, status: order.order_status,
  courier: order.courier, trackingRef: order.tracking_ref,
  placedAt: order.created_at,
  honey: await honeyOf(order),
  payBy: order.payment_status === PAYMENT.PENDING && order.order_status === STATUS.PLACED ? payByOf(order) : null,
  delivery: { name: order.buyer_name, address: order.delivery_address, pincode: order.delivery_pincode },
  seller: { code: org.organization_code, name: org.legal_name, phone: await ownerPhone(org), address: orgAddress(org).text },
  pay: order.payment_status === PAYMENT.PENDING && order.order_status === STATUS.PLACED ? paymentFor(org, order) : null,
  timeline: timeline(order),
})

// The buyer proves who they are with the phone number they ordered with.
async function forBuyer(orderCode, phone) {
  const found = await locate(orderCode)
  if (!found || found.order.buyer_phone !== text(phone, 15).replace(/\s+/g, '')) throw new ShopError('No order matches this code and phone number', 404)
  return found
}

export async function trackOrder(orderCode, phone) {
  return await buyerView(await forBuyer(orderCode, phone))
}

export async function claimPayment(orderCode, phone, reference) {
  const found = await forBuyer(orderCode, phone)
  const ref = text(reference, 40)
  if (ref.length < 6) throw new ShopError('Enter the UPI reference (UTR) number from your payment, at least 6 characters')
  if (found.order.order_status !== STATUS.PLACED) throw new ShopError('This order can no longer be paid', 409)
  if (found.order.payment_status === PAYMENT.PAID) throw new ShopError('The seller has already confirmed this payment', 409)

  await found.privateDb.prepare('UPDATE shop_orders SET payment_status = ?, payment_ref = ?, updated_at = ? WHERE order_code = ?').run(PAYMENT.CLAIMED, ref, now(), found.order.order_code)
  return await trackOrder(orderCode, phone)
}

// A paid order is income of the keeper: the amount before GST is booked in Finance (the GST is collected for the
// government, it is not income). Undoing the payment or cancelling the order takes the entry out again.
async function bookIncome(org, privateDb, order) {
  if (order.finance_entry_id) return
  const base = round2(order.total_inr - (order.gst_inr || 0))
  const note = order.gst_inr > 0 ? ` (GST Rs ${order.gst_inr} collected, not counted as income)` : ''
  const entry = await privateDb.prepare("INSERT INTO finance_entries (entry_date, type, category, description, amount_inr) VALUES (?, 'INCOME', 'Sales income', ?, ?)")
    .run(today(), `Order ${order.order_code} · ${order.buyer_name}${note}`, base)
  await privateDb.prepare('UPDATE shop_orders SET finance_entry_id = ? WHERE order_code = ?').run(entry.lastInsertRowid, order.order_code)
  await syncMonthlyReport(org).catch(() => {})
}

async function reverseIncome(org, privateDb, order) {
  if (!order.finance_entry_id) return
  await privateDb.prepare('DELETE FROM finance_entries WHERE id = ?').run(order.finance_entry_id)
  await privateDb.prepare('UPDATE shop_orders SET finance_entry_id = NULL WHERE order_code = ?').run(order.order_code)
  await syncMonthlyReport(org).catch(() => {})
}

// Puts the jars (or the loose kilograms) back on the shelf.
async function release(found, reason) {
  await reverseIncome(found.org, found.privateDb, found.order)
  await db.transaction(async () => {
    await found.privateDb.prepare('UPDATE shop_orders SET order_status = ?, cancel_reason = ?, updated_at = ? WHERE order_code = ?').run(STATUS.CANCELLED, reason, now(), found.order.order_code)
    await db.prepare('UPDATE shop_listings SET stock_qty = stock_qty + ?, updated_at = ? WHERE id = ?').run(found.order.quantity, now(), found.order.listing_id)
    if (found.order.kind === 'LOOSE') {
      await db.prepare("UPDATE loose_sales SET status = 'CANCELLED' WHERE sale_code = ? AND org_id = ?").run(found.order.order_code, found.org.id)
    } else {
      await returnJars({ orgId: found.org.id, channel: 'SHOP', ref: found.order.order_code })
    }
    await clearJars(found.order.order_code)
    if (found.order.invoice_id) {
      await found.privateDb.prepare("UPDATE invoices SET status = 'Cancelled', paid_at = NULL, finance_entry_id = NULL WHERE id = ? AND status <> 'Cancelled'").run(found.order.invoice_id)
    }
  })()
}

// ---------------------------------------------------------------- which jars are in an order
// The lot (packaging run and harvest batch) an order was taken from.
async function lotOf(packBatchCode) {
  if (!packBatchCode) return null
  return await db.prepare(`
    SELECT pb.id, pb.pack_batch_code, pb.jar_size_grams, b.batch_code, b.honey_type, b.harvest_date,
      (SELECT r.status FROM lab_reviews r WHERE r.batch_id = b.id ORDER BY r.id DESC LIMIT 1) AS lab_status
    FROM pack_batches pb JOIN batches b ON b.id = pb.batch_id WHERE pb.pack_batch_code = ?
  `).get(packBatchCode)
}

async function jarIdsOf(orderCode) {
  const row = await db.prepare('SELECT jar_ids FROM shop_order_index WHERE order_code = ?').get(orderCode)
  try { return JSON.parse(row?.jar_ids || '[]') } catch { return [] }
}

// Puts specific jars (their QR codes) aside for a paid order, so the keeper knows which jars to pack and the buyer can
// check exactly those jars. Jars already put aside for another order of the same packaging run are skipped.
async function assignJars(order) {
  const already = await jarIdsOf(order.order_code)
  if (already.length) return already

  const lot = await lotOf(order.pack_batch_code)
  if (!lot) return []

  return await db.transaction(async () => {
    await lockNamed(`jars:${lot.id}`)
    const again = await jarIdsOf(order.order_code)
    if (again.length) return again

    const free = await pickJarIds(lot.id, order.quantity)

    await db.prepare('UPDATE shop_order_index SET jar_ids = ? WHERE order_code = ?').run(JSON.stringify(free), order.order_code)
    return free
  })()
}

const clearJars = async (orderCode) => { await db.prepare('UPDATE shop_order_index SET jar_ids = NULL WHERE order_code = ?').run(orderCode) }

// What the order page and the keeper's order card show about the honey in the order.
async function honeyOf(order) {
  if (order.kind === 'LOOSE') {
    // No packaging run to look the batch up through: it was sold straight from the harvest batch.
    const batch = order.batch_code ? await db.prepare('SELECT * FROM batches WHERE batch_code = ?').get(order.batch_code) : null
    return {
      packBatchCode: null,
      batchCode: batch?.batch_code || order.batch_code || null, honeyType: batch?.honey_type || null, harvestDate: batch?.harvest_date || null,
      jarSizeGrams: order.jar_size_grams, labVerified: batch ? (await packagingStatus(batch)).labStatus === 'VERIFIED' : false,
      jarIds: [],
    }
  }

  const lot = await lotOf(order.pack_batch_code)
  return {
    packBatchCode: order.pack_batch_code || null,
    batchCode: lot?.batch_code || null, honeyType: lot?.honey_type || null, harvestDate: lot?.harvest_date || null,
    jarSizeGrams: order.jar_size_grams, labVerified: lot?.lab_status === 'VERIFIED',
    jarIds: await jarIdsOf(order.order_code),
  }
}

export async function cancelByBuyer(orderCode, phone) {
  const found = await forBuyer(orderCode, phone)
  if (found.order.order_status !== STATUS.PLACED) throw new ShopError('This order can no longer be cancelled', 409)
  if (found.order.payment_status !== PAYMENT.PENDING) throw new ShopError('You have sent the payment. Please contact the seller to cancel and refund.', 409)
  await release(found, 'Cancelled by the buyer')
  return await trackOrder(orderCode, phone)
}

// ---------------------------------------------------------------- the seller's side
const sellerOrderView = async (order) => ({
  honey: await honeyOf(order),
  code: order.order_code, kind: order.kind, product: order.product_title, jarSizeGrams: order.jar_size_grams, quantity: order.quantity, unitPrice: order.unit_price_inr, gstPercent: order.gst_percent, gst: order.gst_inr, total: order.total_inr,
  buyer: { name: order.buyer_name, phone: order.buyer_phone, email: order.buyer_email, address: order.delivery_address, pincode: order.delivery_pincode },
  paymentStatus: order.payment_status, paymentRef: order.payment_ref, paidAt: order.paid_at,
  status: order.order_status, courier: order.courier, trackingRef: order.tracking_ref, shippedAt: order.shipped_at, deliveredAt: order.delivered_at,
  cancelReason: order.cancel_reason, createdAt: order.created_at,
})

// Orders that were confirmed as paid before payments were booked in Finance get their income entry now.
export async function bookMissingIncome(org, privateDb) {
  const rows = await privateDb.prepare("SELECT * FROM shop_orders WHERE payment_status = 'PAID' AND order_status <> 'CANCELLED' AND finance_entry_id IS NULL").all()
  for (const row of rows) await bookIncome(org, privateDb, row)
}

// Orders placed before Billing invoices existed for Sellers-nearby sales (or before this order was paid) get one
// created retroactively: Paid orders link the finance entry bookIncome already created for them (never a new one),
// Pending orders just get a normal Pending invoice.
export async function backfillMissingInvoices(org, privateDb) {
  const rows = await privateDb.prepare("SELECT * FROM shop_orders WHERE invoice_id IS NULL AND order_status <> 'CANCELLED'").all()
  for (const row of rows) {
    const lot = row.pack_batch_code
      ? await db.prepare('SELECT pb.pack_batch_code, b.batch_code FROM pack_batches pb JOIN batches b ON b.id = pb.batch_id WHERE pb.pack_batch_code = ?').get(row.pack_batch_code)
      : null

    const invoiceId = await createOrderInvoice(org, privateDb, {
      orderCode: row.order_code, title: row.product_title, quantity: row.quantity, unitPrice: row.unit_price_inr,
      gstPercent: row.gst_percent, gstInr: row.gst_inr, totalInr: row.total_inr,
      packBatchCode: row.pack_batch_code, batchCode: lot?.batch_code || row.batch_code || null,
      buyerName: row.buyer_name, buyerPhone: row.buyer_phone, buyerAddress: row.delivery_address,
      issueDate: String(row.created_at).slice(0, 10),
    })

    if (row.payment_status === PAYMENT.PAID) {
      await privateDb.prepare("UPDATE invoices SET status = 'Paid', paid_at = ?, finance_entry_id = ? WHERE id = ?").run(row.paid_at, row.finance_entry_id, invoiceId)
    }
  }
  return rows.length
}

export async function sellerOrders(privateDb) {
  const rows = await privateDb.prepare('SELECT * FROM shop_orders ORDER BY id DESC LIMIT 300').all()

  // Orders that were paid before jars were put aside get theirs now. Loose honey has no jars to assign.
  for (const row of rows) {
    if (row.kind !== 'LOOSE' && row.payment_status === PAYMENT.PAID && row.order_status !== STATUS.CANCELLED) await assignJars(row)
  }
  return await Promise.all(rows.map(sellerOrderView))
}

async function ownOrder(org, privateDb, orderCode) {
  const order = await privateDb.prepare('SELECT * FROM shop_orders WHERE order_code = ?').get(text(orderCode, 40))
  if (!order) throw new ShopError('Order not found', 404)
  return { org, privateDb, order }
}

export async function setPayment(org, privateDb, orderCode, paid) {
  const found = await ownOrder(org, privateDb, orderCode)
  if (found.order.order_status === STATUS.CANCELLED) throw new ShopError('This order was cancelled', 409)
  if (!paid && found.order.order_status !== STATUS.PLACED) throw new ShopError('The parcel already left, the payment can not be undone', 409)

  await privateDb.prepare('UPDATE shop_orders SET payment_status = ?, paid_at = ?, updated_at = ? WHERE order_code = ?')
    .run(paid ? PAYMENT.PAID : PAYMENT.PENDING, paid ? now() : null, now(), found.order.order_code)

  const updated = (await ownOrder(org, privateDb, orderCode)).order
  if (paid) {
    if (updated.kind !== 'LOOSE') await assignJars(updated)
    await bookIncome(org, privateDb, updated)
    // The linked Billing invoice mirrors the same finance entry bookIncome just created — never a second one.
    if (updated.invoice_id) {
      const withEntry = (await ownOrder(org, privateDb, orderCode)).order
      await privateDb.prepare("UPDATE invoices SET status = 'Paid', paid_at = ?, finance_entry_id = ? WHERE id = ?").run(withEntry.paid_at, withEntry.finance_entry_id, updated.invoice_id)
    }
  } else {
    await clearJars(updated.order_code)
    await reverseIncome(org, privateDb, updated)
    if (updated.invoice_id) {
      await privateDb.prepare("UPDATE invoices SET status = 'Pending', paid_at = NULL, finance_entry_id = NULL WHERE id = ?").run(updated.invoice_id)
    }
  }
  return (await ownOrder(org, privateDb, orderCode)).order
}

export async function markShipped(org, privateDb, orderCode, { courier, trackingRef }) {
  const found = await ownOrder(org, privateDb, orderCode)
  if (found.order.order_status !== STATUS.PLACED) throw new ShopError('This order is not waiting to be shipped', 409)
  if (found.order.payment_status !== PAYMENT.PAID) throw new ShopError('Confirm the payment first, then ship the order', 409)
  if (text(courier, 60).length < 2) throw new ShopError('Enter the courier or delivery person')

  await privateDb.prepare('UPDATE shop_orders SET order_status = ?, courier = ?, tracking_ref = ?, shipped_at = ?, updated_at = ? WHERE order_code = ?')
    .run(STATUS.SHIPPED, text(courier, 60), text(trackingRef, 60), now(), now(), found.order.order_code)
  return (await ownOrder(org, privateDb, orderCode)).order
}

export async function markDelivered(org, privateDb, orderCode) {
  const found = await ownOrder(org, privateDb, orderCode)
  if (found.order.order_status !== STATUS.SHIPPED) throw new ShopError('Only a shipped order can be marked delivered', 409)
  await privateDb.prepare('UPDATE shop_orders SET order_status = ?, delivered_at = ?, updated_at = ? WHERE order_code = ?').run(STATUS.DELIVERED, now(), now(), found.order.order_code)
  return (await ownOrder(org, privateDb, orderCode)).order
}

export async function cancelBySeller(org, privateDb, orderCode, reason) {
  const found = await ownOrder(org, privateDb, orderCode)
  if (![STATUS.PLACED].includes(found.order.order_status)) throw new ShopError('Only an order that has not shipped can be cancelled', 409)
  await release(found, text(reason, 200) || 'Cancelled by the seller')
  return (await ownOrder(org, privateDb, orderCode)).order
}

export { sellerOrderView }

// Orders that are still on their way to the buyer: they block closing the company.
export async function openShopOrders(orgCode) {
  const privateDb = await getCompanyDb(orgCode)
  const row = await privateDb.prepare("SELECT COUNT(*) AS n FROM shop_orders WHERE order_status IN ('PLACED', 'SHIPPED')").get()
  return Number(row?.n || 0)
}

// Unpaid orders are cancelled after HOLD_HOURS so a buyer who never pays cannot keep jars off the shelf.
export async function expireUnpaidOrders() {
  const cutoff = new Date(Date.now() - HOLD_HOURS * 3600 * 1000).toISOString()
  const sellers = await db.prepare('SELECT DISTINCT o.* FROM organizations o JOIN shop_order_index i ON i.org_id = o.id').all()
  let cancelled = 0

  for (const org of sellers) {
    const privateDb = await getCompanyDb(org.organization_code)
    const stale = await privateDb.prepare("SELECT * FROM shop_orders WHERE order_status = 'PLACED' AND payment_status = 'PENDING' AND created_at < ?").all(cutoff)
    for (const order of stale) {
      await release({ org, privateDb, order }, `Not paid within ${HOLD_HOURS} hours`)
      cancelled += 1
    }
  }
  return cancelled
}

// ---------------------------------------------------------------- products (keeper)
export async function sellerProducts(org) {
  const gst = await getGstPercent()
  const listings = await Promise.all((await listingRows(org.id, { onlyAvailable: false })).map((row) => productView(row, gst)))

  // Packaging runs of this company that are not on sale yet: the jars exist because a lab result was verified.
  const available = await db.prepare(`
    SELECT pb.id, pb.pack_batch_code, pb.product_name, pb.jar_size_grams, pb.quantity_to_pack, b.batch_code, b.honey_type
    FROM pack_batches pb
    JOIN batches b ON b.id = pb.batch_id
    WHERE b.org_id = ? AND NOT EXISTS (SELECT 1 FROM shop_listings l WHERE l.pack_batch_id = pb.id)
    ORDER BY pb.id DESC
  `).all(org.id)

  // Lab-verified batches with loose honey still to sell, and not already loose-listed: candidates for a loose listing.
  const batches = await db.prepare('SELECT * FROM batches WHERE org_id = ? ORDER BY id DESC').all(org.id)
  const availableLoose = []
  for (const batch of batches) {
    if ((await packagingStatus(batch)).labStatus !== 'VERIFIED') continue
    if (await db.prepare("SELECT 1 FROM shop_listings WHERE batch_id = ? AND kind = 'LOOSE'").get(batch.id)) continue
    const roomKg = Math.floor((await batchCapacity(batch)).remainingGrams / 1000)
    if (roomKg < 1) continue
    availableLoose.push({ batchCode: batch.batch_code, honeyType: batch.honey_type, availableKg: roomKg, minPricePerKg: await minPerKg(batch.honey_type) })
  }

  return {
    gstPercent: gst,
    listings,
    available: await Promise.all(available.map(async (row) => ({ packBatchCode: row.pack_batch_code, productName: row.product_name, jarSizeGrams: row.jar_size_grams, jars: (await lotStock(row.id)).inStock, batchCode: row.batch_code, honeyType: row.honey_type, minPrice: await minPerJar(row.honey_type, row.jar_size_grams) }))),
    availableLoose,
  }
}

// The price (before GST) may be higher than the KVIC minimum but never lower.
async function requireMinimum(price, honeyType, jarGrams) {
  const floor = await minPerJar(honeyType, jarGrams)
  if (price < floor) throw new ShopError(`The KVIC minimum for ${honeyType} in a ${jarGrams} g jar is Rs ${floor} (before GST). Enter that or more.`)
}

export async function createListing(org, input) {
  if (org.selling_mode === 'WHOLESALE') throw new ShopError('This company is registered as wholesale-only and cannot list packaged jars. Ask KVIC to enable packaged selling.', 403)
  if (input.kind === 'LOOSE') return await createLooseListing(org, input)

  const price = Number(input.price)
  const quantity = Number(input.quantity)
  if (!(price > 0 && price <= 100000)) throw new ShopError('Enter the price of one jar in rupees')
  if (!Number.isInteger(quantity) || quantity < 1) throw new ShopError('Enter how many jars to put on sale')

  const lot = await db.prepare(`
    SELECT pb.* FROM pack_batches pb JOIN batches b ON b.id = pb.batch_id
    WHERE pb.pack_batch_code = ? AND b.org_id = ?
  `).get(text(input.packBatchCode, 40), org.id)
  if (!lot) throw new ShopError('Packaging run not found in your organisation', 404)
  const stock = await lotStock(lot.id)
  if (quantity > stock.inStock) throw new ShopError(`Only ${stock.inStock} jar(s) of this packaging run are left in stock`)
  if (await db.prepare('SELECT 1 FROM shop_listings WHERE pack_batch_id = ?').get(lot.id)) throw new ShopError('This packaging run is already on sale', 409)

  const honeyType = (await db.prepare('SELECT honey_type FROM batches WHERE id = ?').get(lot.batch_id))?.honey_type
  await requireMinimum(price, honeyType, lot.jar_size_grams)

  const title = text(input.title, 80) || `${lot.product_name} ${lot.jar_size_grams} g`
  const result = await db.prepare(`
    INSERT INTO shop_listings (org_id, pack_batch_id, title, jar_size_grams, price_inr, listed_qty, stock_qty, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(org.id, lot.id, title, lot.jar_size_grams, price, quantity, quantity, now(), now())
  return result.lastInsertRowid
}

// Loose honey, sold by the kilogram straight from a lab-verified batch, no packaging run needed. Stored as if it
// were "one very large 1000 g jar" (jar_size_grams = 1000), so price_inr reads as rupees per kg and every helper
// built for jars (minPerJar, withGst, the price floor) keeps working unchanged.
async function createLooseListing(org, input) {
  const price = Number(input.price)
  const quantity = Number(input.quantity)
  if (!(price > 0 && price <= 100000)) throw new ShopError('Enter the price per kilogram in rupees')
  if (!Number.isInteger(quantity) || quantity < 1) throw new ShopError('Enter how many kilograms to put on sale')

  const batch = await db.prepare('SELECT * FROM batches WHERE batch_code = ? AND org_id = ?').get(text(input.batchCode, 40), org.id)
  if (!batch) throw new ShopError('Harvest batch not found in your organisation', 404)

  // Jars only ever reach the shop from a batch that already passed lab review (packaging requires it); loose
  // honey has no such gate on its way here, so it is checked explicitly.
  if ((await packagingStatus(batch)).labStatus !== 'VERIFIED') {
    throw new ShopError('This batch has not passed KVIC lab verification yet. Only lab-verified honey can be sold to buyers.', 403)
  }

  const capacity = await batchCapacity(batch)
  const roomKg = Math.floor(capacity.remainingGrams / 1000)
  if (quantity > roomKg) throw new ShopError(`Only ${roomKg} kg of this batch is left to sell (the rest is packed into jars or already sold loose)`)
  if (await db.prepare("SELECT 1 FROM shop_listings WHERE batch_id = ? AND kind = 'LOOSE'").get(batch.id)) throw new ShopError('This batch already has a loose-honey listing', 409)

  await requireMinimum(price, batch.honey_type, 1000)

  const title = text(input.title, 80) || `${batch.honey_type} (loose)`
  const result = await db.prepare(`
    INSERT INTO shop_listings (org_id, batch_id, kind, title, jar_size_grams, price_inr, listed_qty, stock_qty, created_at, updated_at)
    VALUES (?, ?, 'LOOSE', ?, 1000, ?, ?, ?, ?, ?)
  `).run(org.id, batch.id, title, price, quantity, quantity, now(), now())
  return result.lastInsertRowid
}

export async function updateListing(org, id, input) {
  const listing = await db.prepare('SELECT * FROM shop_listings WHERE id = ? AND org_id = ?').get(Number(id), org.id)
  if (!listing) throw new ShopError('Product not found', 404)
  const loose = listing.kind === 'LOOSE'

  const price = input.price === undefined ? listing.price_inr : Number(input.price)
  const stock = input.stock === undefined ? listing.stock_qty : Number(input.stock)
  const active = input.active === undefined ? listing.active : input.active ? 1 : 0

  if (!(price > 0 && price <= 100000)) throw new ShopError(loose ? 'Enter the price per kilogram in rupees' : 'Enter the price of one jar in rupees')

  let room
  if (loose) {
    const batch = await db.prepare('SELECT * FROM batches WHERE id = ?').get(listing.batch_id)
    await requireMinimum(price, batch?.honey_type, 1000)
    room = Math.floor((await batchCapacity(batch)).remainingGrams / 1000)
  } else {
    const honey = (await db.prepare('SELECT b.honey_type FROM pack_batches pb JOIN batches b ON b.id = pb.batch_id WHERE pb.id = ?').get(listing.pack_batch_id))?.honey_type
    await requireMinimum(price, honey, listing.jar_size_grams)
    // The shop can offer only the jars still in the keeper's stock (packed, minus bills and orders).
    room = (await lotStock(listing.pack_batch_id)).inStock
  }

  if (!Number.isInteger(stock) || stock < 0 || stock > room) throw new ShopError(`Stock must be between 0 and ${room} (the ${loose ? 'kilograms' : 'jars'} left in your inventory)`)

  await db.prepare('UPDATE shop_listings SET price_inr = ?, stock_qty = ?, active = ?, title = ?, updated_at = ? WHERE id = ?')
    .run(price, stock, active, text(input.title, 80) || listing.title, now(), listing.id)
}
