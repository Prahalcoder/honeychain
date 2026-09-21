import crypto from 'node:crypto'

import db from '../database/database.js'
import { REGIONS } from '../config/regions.js'
import { formatAddress } from '../config/sampleData.js'
import { getCompanyDb } from './companyDb.js'

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

// An order nobody pays for is cancelled after this many hours and its jars go back on the shelf.
const HOLD_HOURS = Number(process.env.SHOP_HOLD_HOURS || 24)
const payByOf = (order) => new Date(Date.parse(order.created_at) + HOLD_HOURS * 3600 * 1000).toISOString()
const text = (value, max) => String(value ?? '').trim().slice(0, max)
const PHONE = /^[6-9]\d{9}$/
const PIN = /^\d{6}$/
const UPI = /^[a-zA-Z0-9._-]{2,}@[a-zA-Z0-9]{2,}$/

export const validUpi = (value) => UPI.test(String(value || ''))

const ownerPhone = async (org) => (await db.prepare('SELECT phone FROM user_settings WHERE user_id = ?').get(org.owner_user_id))?.phone || ''

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
// Every state with the number of sellers per region (only companies with something in stock).
export async function browseStates() {
  const rows = await db.prepare(`
    SELECT o.state, o.region, COUNT(DISTINCT o.id) AS sellers
    FROM organizations o
    JOIN shop_listings l ON l.org_id = o.id AND l.active = 1 AND l.stock_qty > 0
    WHERE o.status = 'APPROVED'
    GROUP BY o.state, o.region
  `).all()

  const counts = new Map(rows.map((row) => [`${row.state}|${row.region}`, row.sellers]))

  return Object.entries(REGIONS).map(([state, regions]) => {
    const list = regions.map((region) => ({ region, sellers: counts.get(`${state}|${region}`) || 0 }))
    return { state, sellers: list.reduce((sum, item) => sum + item.sellers, 0), regions: list }
  })
}

export async function browseSellers({ state = '', region = '' }) {
  const conditions = ["o.status = 'APPROVED'"]
  const params = []
  if (state) { conditions.push('o.state = ?'); params.push(state) }
  if (region) { conditions.push('o.region = ?'); params.push(region) }

  const rows = await db.prepare(`
    SELECT o.organization_code, o.legal_name, o.state, o.region, o.locality, o.district, o.pincode,
      COUNT(l.id) AS product_count, MIN(l.price_inr) AS from_price, COALESCE(SUM(l.stock_qty), 0) AS jars
    FROM organizations o
    JOIN shop_listings l ON l.org_id = o.id AND l.active = 1 AND l.stock_qty > 0
    WHERE ${conditions.join(' AND ')}
    GROUP BY o.id
    ORDER BY o.state, o.region, o.legal_name
  `).all(...params)

  return rows.map((row) => ({
    code: row.organization_code, name: row.legal_name, state: row.state, region: row.region,
    place: [row.locality, row.district].filter(Boolean).join(', '), pincode: row.pincode,
    products: row.product_count, fromPrice: row.from_price, jars: row.jars,
  }))
}

async function listingRows(orgId, { onlyAvailable = true } = {}) {
  return await db.prepare(`
    SELECT l.id, l.title, l.jar_size_grams, l.price_inr, l.stock_qty, l.active, pb.pack_batch_code, b.batch_code, b.honey_type, b.harvest_date,
      (SELECT r.status FROM lab_reviews r WHERE r.batch_id = b.id ORDER BY r.id DESC LIMIT 1) AS lab_status
    FROM shop_listings l
    JOIN pack_batches pb ON pb.id = l.pack_batch_id
    JOIN batches b ON b.id = pb.batch_id
    WHERE l.org_id = ? ${onlyAvailable ? 'AND l.active = 1 AND l.stock_qty > 0' : ''}
    ORDER BY l.id DESC
  `).all(orgId)
}

const productView = (row) => ({
  id: row.id, title: row.title, jarSizeGrams: row.jar_size_grams, price: row.price_inr, stock: row.stock_qty, active: Boolean(row.active),
  packBatchCode: row.pack_batch_code, batchCode: row.batch_code, honeyType: row.honey_type, harvestDate: row.harvest_date,
  labVerified: row.lab_status === 'VERIFIED',
})

export async function sellerDetail(code) {
  const org = await db.prepare("SELECT * FROM organizations WHERE organization_code = ? AND status = 'APPROVED'").get(text(code, 40))
  if (!org) return null

  return {
    code: org.organization_code, name: org.legal_name, state: org.state, region: org.region,
    address: orgAddress(org), phone: await ownerPhone(org), fssai: org.fssai_license,
    products: (await listingRows(org.id)).map(productView),
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
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) throw new ShopError('Choose between 1 and 50 jars')

  const org = await db.prepare("SELECT * FROM organizations WHERE organization_code = ? AND status = 'APPROVED'").get(code)
  const listing = org && await db.prepare('SELECT * FROM shop_listings WHERE id = ? AND org_id = ? AND active = 1').get(listingId, org.id)
  if (!listing) throw new ShopError('This product is no longer for sale', 404)

  const privateDb = await getCompanyDb(org.organization_code)
  const orderCode = `ORD-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`

  const lot = await db.prepare('SELECT pack_batch_code FROM pack_batches WHERE id = ?').get(listing.pack_batch_id)

  await db.transaction(async () => {
    const taken = await db.prepare('UPDATE shop_listings SET stock_qty = stock_qty - ?, updated_at = ? WHERE id = ? AND stock_qty >= ? AND active = 1')
      .run(quantity, now(), listing.id, quantity)

    if (!taken.changes) {
      const left = (await db.prepare('SELECT stock_qty FROM shop_listings WHERE id = ?').get(listing.id)).stock_qty
      throw new ShopError(left > 0 ? `Only ${left} left. Please choose fewer jars.` : 'Sorry, this product just sold out.', 409)
    }

    await privateDb.prepare(`
      INSERT INTO shop_orders
      (order_code, listing_id, pack_batch_code, product_title, jar_size_grams, quantity, unit_price_inr, total_inr,
        buyer_name, buyer_phone, buyer_email, delivery_address, delivery_pincode, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(orderCode, listing.id, lot?.pack_batch_code ?? null, listing.title, listing.jar_size_grams, quantity, listing.price_inr, Math.round(listing.price_inr * quantity * 100) / 100,
      name, phone, email, address, pincode, now(), now())

    await db.prepare('INSERT INTO shop_order_index (order_code, org_id, listing_id) VALUES (?, ?, ?)').run(orderCode, org.id, listing.id)
  })()

  return orderCode
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
  code: order.order_code,
  product: order.product_title, jarSizeGrams: order.jar_size_grams, quantity: order.quantity, unitPrice: order.unit_price_inr, total: order.total_inr,
  paymentStatus: order.payment_status, paymentRef: order.payment_ref, status: order.order_status,
  courier: order.courier, trackingRef: order.tracking_ref,
  placedAt: order.created_at,
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

// Puts the jars back on the shelf.
async function release(found, reason) {
  await db.transaction(async () => {
    await found.privateDb.prepare('UPDATE shop_orders SET order_status = ?, cancel_reason = ?, updated_at = ? WHERE order_code = ?').run(STATUS.CANCELLED, reason, now(), found.order.order_code)
    await db.prepare('UPDATE shop_listings SET stock_qty = stock_qty + ?, updated_at = ? WHERE id = ?').run(found.order.quantity, now(), found.order.listing_id)
  })()
}

export async function cancelByBuyer(orderCode, phone) {
  const found = await forBuyer(orderCode, phone)
  if (found.order.order_status !== STATUS.PLACED) throw new ShopError('This order can no longer be cancelled', 409)
  if (found.order.payment_status !== PAYMENT.PENDING) throw new ShopError('You have sent the payment. Please contact the seller to cancel and refund.', 409)
  await release(found, 'Cancelled by the buyer')
  return await trackOrder(orderCode, phone)
}

// ---------------------------------------------------------------- the seller's side
const sellerOrderView = (order) => ({
  code: order.order_code, product: order.product_title, jarSizeGrams: order.jar_size_grams, quantity: order.quantity, unitPrice: order.unit_price_inr, total: order.total_inr,
  buyer: { name: order.buyer_name, phone: order.buyer_phone, email: order.buyer_email, address: order.delivery_address, pincode: order.delivery_pincode },
  paymentStatus: order.payment_status, paymentRef: order.payment_ref, paidAt: order.paid_at,
  status: order.order_status, courier: order.courier, trackingRef: order.tracking_ref, shippedAt: order.shipped_at, deliveredAt: order.delivered_at,
  cancelReason: order.cancel_reason, createdAt: order.created_at,
})

export async function sellerOrders(privateDb) {
  const rows = await privateDb.prepare('SELECT * FROM shop_orders ORDER BY id DESC LIMIT 300').all()
  return rows.map(sellerOrderView)
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
      await release({ privateDb, order }, `Not paid within ${HOLD_HOURS} hours`)
      cancelled += 1
    }
  }
  return cancelled
}

// ---------------------------------------------------------------- products (keeper)
export async function sellerProducts(org) {
  const listings = (await listingRows(org.id, { onlyAvailable: false })).map(productView)

  // Packaging runs of this company that are not on sale yet: the jars exist because a lab result was verified.
  const available = await db.prepare(`
    SELECT pb.pack_batch_code, pb.product_name, pb.jar_size_grams, pb.quantity_to_pack, b.batch_code, b.honey_type
    FROM pack_batches pb
    JOIN batches b ON b.id = pb.batch_id
    WHERE b.org_id = ? AND NOT EXISTS (SELECT 1 FROM shop_listings l WHERE l.pack_batch_id = pb.id)
    ORDER BY pb.id DESC
  `).all(org.id)

  return {
    listings,
    available: available.map((row) => ({ packBatchCode: row.pack_batch_code, productName: row.product_name, jarSizeGrams: row.jar_size_grams, jars: row.quantity_to_pack, batchCode: row.batch_code, honeyType: row.honey_type })),
  }
}

export async function createListing(org, input) {
  const price = Number(input.price)
  const quantity = Number(input.quantity)
  if (!(price > 0 && price <= 100000)) throw new ShopError('Enter the price of one jar in rupees')
  if (!Number.isInteger(quantity) || quantity < 1) throw new ShopError('Enter how many jars to put on sale')

  const lot = await db.prepare(`
    SELECT pb.* FROM pack_batches pb JOIN batches b ON b.id = pb.batch_id
    WHERE pb.pack_batch_code = ? AND b.org_id = ?
  `).get(text(input.packBatchCode, 40), org.id)
  if (!lot) throw new ShopError('Packaging run not found in your organisation', 404)
  if (quantity > lot.quantity_to_pack) throw new ShopError(`This packaging run has only ${lot.quantity_to_pack} jars`)
  if (await db.prepare('SELECT 1 FROM shop_listings WHERE pack_batch_id = ?').get(lot.id)) throw new ShopError('This packaging run is already on sale', 409)

  const title = text(input.title, 80) || `${lot.product_name} ${lot.jar_size_grams} g`
  const result = await db.prepare(`
    INSERT INTO shop_listings (org_id, pack_batch_id, title, jar_size_grams, price_inr, listed_qty, stock_qty, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(org.id, lot.id, title, lot.jar_size_grams, price, quantity, quantity, now(), now())
  return result.lastInsertRowid
}

export async function updateListing(org, id, input) {
  const listing = await db.prepare('SELECT l.*, pb.quantity_to_pack FROM shop_listings l JOIN pack_batches pb ON pb.id = l.pack_batch_id WHERE l.id = ? AND l.org_id = ?').get(Number(id), org.id)
  if (!listing) throw new ShopError('Product not found', 404)

  const price = input.price === undefined ? listing.price_inr : Number(input.price)
  const stock = input.stock === undefined ? listing.stock_qty : Number(input.stock)
  const active = input.active === undefined ? listing.active : input.active ? 1 : 0

  if (!(price > 0 && price <= 100000)) throw new ShopError('Enter the price of one jar in rupees')
  // Jars already ordered (and not cancelled) still count: stock plus orders can not exceed what was packed.
  const privateDb = await getCompanyDb(org.organization_code)
  const committed = Number((await privateDb.prepare("SELECT COALESCE(SUM(quantity), 0) AS n FROM shop_orders WHERE listing_id = ? AND order_status <> 'CANCELLED'").get(listing.id))?.n || 0)
  const room = listing.quantity_to_pack - committed
  if (!Number.isInteger(stock) || stock < 0 || stock > room) throw new ShopError(`Stock must be between 0 and ${room}${committed ? ` (${committed} jar(s) are already ordered)` : ''}`)

  await db.prepare('UPDATE shop_listings SET price_inr = ?, stock_qty = ?, active = ?, title = ?, updated_at = ? WHERE id = ?')
    .run(price, stock, active, text(input.title, 80) || listing.title, now(), listing.id)
}
