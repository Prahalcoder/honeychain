import db from '../database/database.js'
import { seedMinimumPerKg } from '../config/honeyCatalogue.js'

// Prices and GST are set once for everybody by the KVIC head office:
//  - one standard GST percentage that every keeper charges on jars (billing and Sellers nearby), and
//  - a suggested minimum price per kg for each honey type. A keeper may charge more, never less.
// A keeper's own price is the price before GST; GST is added on top to get the final price the buyer pays.
export class PricingError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

export const DEFAULT_GST_PERCENT = 5
const OTHER_MIN_PER_KG = seedMinimumPerKg('Other')

const round2 = (value) => Math.round(value * 100) / 100
const now = () => new Date().toISOString()

export async function getGstPercent() {
  const row = await db.prepare("SELECT value FROM platform_settings WHERE key = 'jar_gst_percent'").get()
  const value = Number(row?.value)
  return Number.isFinite(value) ? value : DEFAULT_GST_PERCENT
}

export async function setGstPercent(percent, userId) {
  const value = Number(percent)
  if (!Number.isFinite(value) || value < 0 || value > 28) throw new PricingError('GST must be between 0 and 28 percent')

  await db.prepare(`
    INSERT INTO platform_settings (key, value, updated_by, updated_at) VALUES ('jar_gst_percent', ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
  `).run(String(round2(value)), userId, now())
  return round2(value)
}

export async function guidance() {
  const rows = await db.prepare('SELECT honey_type, min_price_per_kg, updated_at FROM price_guidance ORDER BY honey_type').all()
  return rows.map((row) => ({ honeyType: row.honey_type, minPricePerKg: Number(row.min_price_per_kg), updatedAt: row.updated_at }))
}

export async function minPerKg(honeyType) {
  const row = await db.prepare('SELECT min_price_per_kg FROM price_guidance WHERE honey_type = ?').get(honeyType)
  if (row) return Number(row.min_price_per_kg)
  const other = await db.prepare("SELECT min_price_per_kg FROM price_guidance WHERE honey_type = 'Other'").get()
  return Number(other?.min_price_per_kg || OTHER_MIN_PER_KG)
}

// The lowest price (before GST) of one jar of this honey, rounded up to a whole rupee.
export async function minPerJar(honeyType, jarGrams) {
  return Math.ceil(((await minPerKg(honeyType)) * jarGrams) / 1000)
}

export const withGst = (price, gstPercent) => round2(price * (1 + gstPercent / 100))

// The head office changes the minimum of a honey type. Listings that fall below it are raised to it.
export async function setMinimum(honeyType, minPricePerKg, userId) {
  const type = String(honeyType || '').trim()
  const value = Number(minPricePerKg)
  const known = await db.prepare('SELECT 1 AS found FROM price_guidance WHERE honey_type = ?').get(type)
  if (!known) throw new PricingError('Unknown honey type', 404)
  if (!Number.isFinite(value) || value <= 0 || value > 100000) throw new PricingError('Enter the minimum price per kg in rupees')

  await db.prepare('UPDATE price_guidance SET min_price_per_kg = ?, updated_by = ?, updated_at = ? WHERE honey_type = ?').run(round2(value), userId, now(), type)
  return await raiseListingsToMinimum()
}

// Every shop listing is at or above the minimum of its honey type. Returns how many were raised.
export async function raiseListingsToMinimum() {
  // A LOOSE listing has no packaging run, so its batch is reached through l.batch_id instead of pb.batch_id;
  // it is always stored as jar_size_grams = 1000 (see services/shop.js), so minPerJar(..., 1000) is its per-kg floor.
  const listings = await db.prepare(`
    SELECT l.id, l.price_inr, l.jar_size_grams, b.honey_type
    FROM shop_listings l LEFT JOIN pack_batches pb ON pb.id = l.pack_batch_id JOIN batches b ON b.id = COALESCE(pb.batch_id, l.batch_id)
  `).all()

  let raised = 0
  for (const listing of listings) {
    const floor = await minPerJar(listing.honey_type, listing.jar_size_grams)
    if (Number(listing.price_inr) < floor) {
      await db.prepare('UPDATE shop_listings SET price_inr = ?, updated_at = ? WHERE id = ?').run(floor, now(), listing.id)
      raised += 1
    }
  }
  return raised
}
