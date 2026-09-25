import db from '../database/database.js'
import { nextCode } from './codes.js'
import { getBatch } from './batches.js'
import { getCompanyDb } from './companyDb.js'
import { lockNamed } from './ledgerLock.js'
import { minPerKg } from './pricing.js'
import { SaleError, createLooseSale } from './looseSales.js'
import { TRADER_TYPE } from '../config/registration.js'

// The wholesale side of Honey Chain: a registered, KVIC-approved wholesaler / trader / packer sees loose honey
// that approved beekeepers still have in their batches and offers to buy it. The beekeeper accepts or declines.
// Accepting records an ordinary loose sale in the keeper's own books (bill in Billing, kilograms out of the
// batch, custody hand-over to the wholesaler sealed on the chain), so every existing check applies. An offer can
// never be below the KVIC minimum price per kg for that honey type: a trader cannot underpay a rural beekeeper.
export class TradeError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

const round2 = (value) => Math.round(value * 100) / 100
const text = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const today = () => new Date().toLocaleDateString('en-CA')
export const MIN_OFFER_KG = 1

// Loose honey on offer from approved beekeepers, biggest lots first. `pendingKg` is what other wholesalers have
// already asked for and not yet been answered on, so a trader can see how contested a lot is.
export async function marketListings({ state = '', honeyType = '', labVerifiedOnly = false } = {}) {
  const conditions = ["o.status = 'APPROVED'", 'o.organization_type <> ?']
  const params = [TRADER_TYPE]
  if (state) { conditions.push('o.state = ?'); params.push(state) }
  if (honeyType) { conditions.push('b.honey_type = ?'); params.push(honeyType) }

  const rows = await db.prepare(`
    SELECT b.id, b.batch_code, b.honey_type, b.harvest_date, b.quantity_kg,
      o.organization_code, o.legal_name, o.state, o.region, o.district, o.locality,
      COALESCE((SELECT SUM(pb.jar_size_grams * pb.quantity_to_pack) FROM pack_batches pb WHERE pb.batch_id = b.id), 0) AS packed_grams,
      COALESCE((SELECT SUM(ls.grams) FROM loose_sales ls WHERE ls.batch_id = b.id AND ls.status = 'ACTIVE'), 0) AS loose_grams,
      (SELECT COUNT(*) FROM lab_reviews r JOIN laboratory_tests t ON t.id = r.lab_test_id
        WHERE r.batch_id = b.id AND r.status = 'VERIFIED' AND t.status = 'PASSED') AS verified_reviews,
      COALESCE((SELECT SUM(pr.quantity_kg) FROM purchase_requests pr WHERE pr.batch_id = b.id AND pr.status = 'PENDING'), 0) AS pending_kg
    FROM batches b JOIN organizations o ON o.id = b.org_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY b.id DESC LIMIT 400
  `).all(...params)

  const floors = new Map()
  const floorOf = async (type) => {
    if (!floors.has(type)) floors.set(type, await minPerKg(type))
    return floors.get(type)
  }

  const listings = []
  for (const row of rows) {
    const availableKg = Math.floor((Math.round(Number(row.quantity_kg) * 1000) - Number(row.packed_grams) - Number(row.loose_grams)) / 100) / 10
    if (availableKg < MIN_OFFER_KG) continue
    const labVerified = Number(row.verified_reviews) > 0
    if (labVerifiedOnly && !labVerified) continue
    listings.push({
      batchCode: row.batch_code, honeyType: row.honey_type, harvestDate: row.harvest_date, harvestedKg: Number(row.quantity_kg), availableKg,
      labVerified, pendingKg: round2(Number(row.pending_kg)), minPricePerKg: await floorOf(row.honey_type),
      keeper: { code: row.organization_code, name: row.legal_name, state: row.state, region: row.region, place: [row.locality, row.district].filter(Boolean).join(', ') },
    })
  }
  return listings.sort((a, b) => b.availableKg - a.availableKg)
}

function requestView(row) {
  return {
    code: row.request_code, status: row.status, batchCode: row.batch_code, honeyType: row.honey_type, harvestDate: row.harvest_date,
    quantityKg: Number(row.quantity_kg), offerPricePerKg: Number(row.offer_price_per_kg), offerTotal: round2(Number(row.quantity_kg) * Number(row.offer_price_per_kg)),
    pickupDate: row.pickup_date, note: row.note, decidedNote: row.decided_note, saleCode: row.sale_code, invoiceNumber: row.invoice_number,
    createdAt: row.created_at, decidedAt: row.decided_at,
  }
}

// ------------------------------------------------------------------ wholesaler side
export async function createRequest(traderOrg, { batchCode, quantityKg, offerPricePerKg, pickupDate, note }) {
  const batch = await getBatch(text(batchCode, 40))
  const keeper = batch && await db.prepare('SELECT * FROM organizations WHERE id = ?').get(batch.org_id)
  if (!batch || !keeper || keeper.status !== 'APPROVED' || keeper.organization_type === TRADER_TYPE) throw new TradeError('This honey is no longer on offer', 404)
  if (keeper.id === traderOrg.id) throw new TradeError('You cannot buy from your own company')

  const quantity = Number(quantityKg)
  const price = Number(offerPricePerKg)
  if (!Number.isFinite(quantity) || quantity < MIN_OFFER_KG || quantity > 100000) throw new TradeError(`Offer for at least ${MIN_OFFER_KG} kg`)
  if (!Number.isFinite(price) || price <= 0 || price > 100000) throw new TradeError('Enter your offer price per kg in rupees')

  const floor = await minPerKg(batch.honey_type)
  if (price < floor) throw new TradeError(`KVIC's minimum for ${batch.honey_type} is Rs ${floor} per kg. Offers below it are not accepted, so beekeepers are never underpaid.`)

  const listing = (await marketListings({})).find((item) => item.batchCode === batch.batch_code)
  const available = listing?.availableKg || 0
  if (quantity > available) throw new TradeError(available > 0 ? `Only ${available} kg of this batch is available` : 'This batch has no loose honey left', 409)

  const pickup = text(pickupDate, 10)
  if (pickup && (!/^\d{4}-\d{2}-\d{2}$/.test(pickup) || pickup < today())) throw new TradeError('The pickup date must be today or later')

  if (await db.prepare("SELECT 1 FROM purchase_requests WHERE trader_org_id = ? AND batch_id = ? AND status = 'PENDING'").get(traderOrg.id, batch.id)) {
    throw new TradeError('You already have an open offer for this batch. Cancel it first to make a new one.', 409)
  }

  const code = nextCode('PRQ')
  await db.prepare(`
    INSERT INTO purchase_requests (request_code, trader_org_id, keeper_org_id, batch_id, quantity_kg, offer_price_per_kg, pickup_date, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(code, traderOrg.id, keeper.id, batch.id, round2(quantity), round2(price), pickup || null, text(note, 300), new Date().toISOString())
  return code
}

export async function traderRequests(traderOrgId) {
  return (await db.prepare(`
    SELECT pr.*, b.batch_code, b.honey_type, b.harvest_date, o.legal_name AS keeper_name, o.state AS keeper_state, o.region AS keeper_region,
      o.locality AS keeper_locality, o.district AS keeper_district, s.phone AS keeper_phone
    FROM purchase_requests pr
    JOIN batches b ON b.id = pr.batch_id
    JOIN organizations o ON o.id = pr.keeper_org_id
    LEFT JOIN user_settings s ON s.user_id = o.owner_user_id
    WHERE pr.trader_org_id = ? ORDER BY pr.id DESC LIMIT 300
  `).all(traderOrgId)).map((row) => ({
    ...requestView(row),
    keeper: {
      name: row.keeper_name, state: row.keeper_state, region: row.keeper_region, place: [row.keeper_locality, row.keeper_district].filter(Boolean).join(', '),
      // The keeper's phone is shared once they accept, so the two can arrange the pickup.
      phone: row.status === 'ACCEPTED' ? row.keeper_phone || '' : '',
    },
  }))
}

export async function cancelRequest(traderOrg, code) {
  const result = await db.prepare("UPDATE purchase_requests SET status = 'CANCELLED', decided_at = ?, decided_note = 'Withdrawn by the wholesaler' WHERE request_code = ? AND trader_org_id = ? AND status = 'PENDING'")
    .run(new Date().toISOString(), text(code, 40), traderOrg.id)
  if (!result.changes) throw new TradeError('Only an offer that is still waiting for the beekeeper can be withdrawn', 409)
}

// ------------------------------------------------------------------ beekeeper side
export async function keeperRequests(keeperOrgId) {
  return (await db.prepare(`
    SELECT pr.*, b.batch_code, b.honey_type, b.harvest_date, o.legal_name AS trader_name, o.gstin AS trader_gstin, o.state AS trader_state,
      o.region AS trader_region, o.district AS trader_district, o.fssai_license AS trader_fssai, o.madhukranti_id AS trader_registration,
      s.phone AS trader_phone, s.email AS trader_email, p.details_json AS trader_details
    FROM purchase_requests pr
    JOIN batches b ON b.id = pr.batch_id
    JOIN organizations o ON o.id = pr.trader_org_id
    LEFT JOIN user_settings s ON s.user_id = o.owner_user_id
    LEFT JOIN organization_profiles p ON p.org_id = o.id
    WHERE pr.keeper_org_id = ? ORDER BY (pr.status = 'PENDING') DESC, pr.id DESC LIMIT 300
  `).all(keeperOrgId)).map((row) => {
    const trade = (() => { try { return JSON.parse(row.trader_details || '{}').trade || {} } catch { return {} } })()
    return {
      ...requestView(row),
      trader: {
        name: row.trader_name, gstin: row.trader_gstin, fssai: row.trader_fssai, registrationNo: row.trader_registration,
        state: row.trader_state, region: row.trader_region, district: row.trader_district, phone: row.trader_phone || '', email: row.trader_email || '',
        businessType: trade.businessType || '', brandName: trade.brandName || '',
      },
    }
  })
}

// The wholesaler becomes a buyer in the keeper's own Buyers list (matched by GSTIN), the same way the keeper
// would add them by hand before a loose sale.
export async function buyerFor(privateDb, trader, phone) {
  const existing = trader.gstin && await privateDb.prepare("SELECT * FROM buyers WHERE gstin = ? AND type = 'Wholesaler'").get(trader.gstin)
  if (existing) return existing
  const address = [trader.address_line, trader.locality, trader.district, trader.state, trader.pincode].filter(Boolean).join(', ')
  const created = await privateDb.prepare("INSERT INTO buyers (name, type, contact, gstin, address) VALUES (?, 'Wholesaler', ?, ?, ?)")
    .run(trader.legal_name, phone || '', trader.gstin || '', address)
  return await privateDb.prepare('SELECT * FROM buyers WHERE id = ?').get(created.lastInsertRowid)
}

export async function acceptRequest(keeperOrg, user, code, { gstPercent = 0, paid = false, note = '' } = {}) {
  const request = await db.prepare('SELECT * FROM purchase_requests WHERE request_code = ? AND keeper_org_id = ?').get(text(code, 40), keeperOrg.id)
  if (!request) throw new TradeError('Offer not found', 404)
  if (request.status !== 'PENDING') throw new TradeError(`This offer is already ${request.status.toLowerCase()}`, 409)

  const trader = await db.prepare('SELECT * FROM organizations WHERE id = ?').get(request.trader_org_id)
  if (!trader || trader.status !== 'APPROVED') throw new TradeError('This wholesaler is no longer approved by KVIC, so the offer cannot be accepted', 409)
  const phone = (await db.prepare('SELECT phone FROM user_settings WHERE user_id = ?').get(trader.owner_user_id))?.phone || ''
  const batch = await db.prepare('SELECT * FROM batches WHERE id = ?').get(request.batch_id)

  // Claim the offer first so two clicks (or two devices) can never turn one offer into two sales.
  const claimed = await db.prepare("UPDATE purchase_requests SET status = 'ACCEPTING' WHERE id = ? AND status = 'PENDING'").run(request.id)
  if (!claimed.changes) throw new TradeError('This offer was just answered', 409)

  try {
    const privateDb = await getCompanyDb(keeperOrg.organization_code)
    const buyer = await buyerFor(privateDb, trader, phone)
    const sale = await createLooseSale({
      org: keeperOrg, user, privateDb, buyer, batch,
      grams: Math.round(Number(request.quantity_kg) * 1000),
      pricePerKg: Number(request.offer_price_per_kg), gstPercent: Number(gstPercent) || 0, paid: paid === true, publicName: true,
      note: `Wholesaler offer ${request.request_code}${text(note, 120) ? `: ${text(note, 120)}` : ''}`,
      extraMetadata: { purchaseRequest: request.request_code },
    })
    await db.prepare("UPDATE purchase_requests SET status = 'ACCEPTED', sale_code = ?, invoice_number = ?, decided_at = ?, decided_note = ? WHERE id = ?")
      .run(sale.code, sale.invoiceNumber, new Date().toISOString(), text(note, 300) || null, request.id)
    return { ...sale, requestCode: request.request_code }
  } catch (error) {
    await db.prepare("UPDATE purchase_requests SET status = 'PENDING' WHERE id = ? AND status = 'ACCEPTING'").run(request.id)
    if (error instanceof SaleError) throw new TradeError(error.message, error.status)
    throw error
  }
}

export async function declineRequest(keeperOrg, code, reason) {
  const note = text(reason, 300)
  if (note.length < 3) throw new TradeError('Tell the wholesaler why (at least 3 characters)')
  const result = await db.prepare("UPDATE purchase_requests SET status = 'DECLINED', decided_at = ?, decided_note = ? WHERE request_code = ? AND keeper_org_id = ? AND status = 'PENDING'")
    .run(new Date().toISOString(), note, text(code, 40), keeperOrg.id)
  if (!result.changes) throw new TradeError('Only an offer that is still waiting can be declined', 409)
}

export async function pendingOfferCount(keeperOrgId) {
  return Number((await db.prepare("SELECT COUNT(*) AS n FROM purchase_requests WHERE keeper_org_id = ? AND status = 'PENDING'").get(keeperOrgId)).n)
}

// When a keeper cancels the loose sale that came from an offer, the offer is closed too.
export async function releaseForCancelledSale(keeperOrgId, saleCode) {
  await db.prepare("UPDATE purchase_requests SET status = 'CANCELLED', decided_note = COALESCE(decided_note, '') || ' (sale cancelled by the beekeeper)' WHERE keeper_org_id = ? AND sale_code = ? AND status = 'ACCEPTED'")
    .run(keeperOrgId, saleCode)
}
