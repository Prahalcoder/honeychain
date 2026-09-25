import db from '../database/database.js'
import { lockNamed } from './ledgerLock.js'

// Bottle stock. A packaging run makes `quantity_to_pack` jars. Every jar that leaves through a bill or the shop is a
// row in jar_sales, so the stock of a run is simply what was packed minus the active rows. Cancelling a bill or an
// order cancels its rows and the jars come back.
export class JarError extends Error {
  constructor(message, status = 409) {
    super(message)
    this.status = status
  }
}

const now = () => new Date().toISOString()
const num = (value) => Number(value || 0)

// Packed, sold on bills, sold through the shop and left in stock, for one packaging run.
export async function lotStock(packBatchId) {
  const lot = await db.prepare('SELECT quantity_to_pack FROM pack_batches WHERE id = ?').get(packBatchId)
  const sold = await db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN channel = 'BILL' THEN quantity ELSE 0 END), 0) AS bills,
      COALESCE(SUM(CASE WHEN channel = 'SHOP' THEN quantity ELSE 0 END), 0) AS shop
    FROM jar_sales WHERE pack_batch_id = ? AND status = 'ACTIVE'
  `).get(packBatchId)

  const packed = num(lot?.quantity_to_pack)
  const bills = num(sold?.bills)
  const shop = num(sold?.shop)
  return { packed, soldBills: bills, soldShop: shop, sold: bills + shop, inStock: Math.max(0, packed - bills - shop) }
}

// Every packaging run of a company with its stock, newest first.
export async function orgLots(orgId) {
  const lots = await db.prepare(`
    SELECT pb.id, pb.pack_batch_code, pb.product_name, pb.jar_size_grams, b.batch_code, b.honey_type
    FROM pack_batches pb JOIN batches b ON b.id = pb.batch_id
    WHERE b.org_id = ? ORDER BY pb.id DESC
  `).all(orgId)

  return await Promise.all(lots.map(async (lot) => ({
    id: lot.id, packBatchCode: lot.pack_batch_code, productName: lot.product_name, jarSizeGrams: lot.jar_size_grams,
    batchCode: lot.batch_code, honeyType: lot.honey_type, ...(await lotStock(lot.id)),
  })))
}

// The jar QR codes (pack ids) already named on a bill or put aside for a paid shop order.
async function namedJarIds(packBatchId) {
  const named = new Set()
  const rows = [
    ...await db.prepare("SELECT jar_ids FROM jar_sales WHERE pack_batch_id = ? AND status = 'ACTIVE' AND jar_ids IS NOT NULL").all(packBatchId),
    ...await db.prepare('SELECT i.jar_ids FROM shop_order_index i JOIN shop_listings l ON l.id = i.listing_id WHERE l.pack_batch_id = ? AND i.jar_ids IS NOT NULL').all(packBatchId),
  ]
  for (const row of rows) { try { JSON.parse(row.jar_ids).forEach((id) => named.add(id)) } catch { /* ignore */ } }
  return named
}

// The next free jar QR codes of a packaging run. Call while holding the run's lock.
export async function pickJarIds(packBatchId, quantity) {
  const named = await namedJarIds(packBatchId)
  return (await db.prepare("SELECT pack_id FROM packs WHERE pack_batch_id = ? AND status = 'ACTIVE' ORDER BY id").all(packBatchId))
    .map((row) => row.pack_id).filter((id) => !named.has(id)).slice(0, quantity)
}

// Takes jars out of stock. Call inside a transaction: the lock keeps two sales from taking the same jars.
// With `assign` the specific jar QR codes are named too (bills); shop orders name theirs once they are paid.
export async function takeJars({ orgId, packBatchId, quantity, channel, ref, assign = false }) {
  await lockNamed(`jars:${packBatchId}`)
  const stock = await lotStock(packBatchId)
  if (quantity > stock.inStock) {
    throw new JarError(stock.inStock > 0 ? `Only ${stock.inStock} jar(s) of this packaging run are left in stock.` : 'No jars of this packaging run are left in stock.')
  }

  const jarIds = assign ? await pickJarIds(packBatchId, quantity) : []
  await db.prepare('INSERT INTO jar_sales (org_id, pack_batch_id, quantity, channel, ref, created_at, jar_ids) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(orgId, packBatchId, quantity, channel, ref, now(), assign ? JSON.stringify(jarIds) : null)

  // The shop can never offer more jars than are left.
  const left = stock.inStock - quantity
  await db.prepare('UPDATE shop_listings SET stock_qty = ?, updated_at = ? WHERE pack_batch_id = ? AND stock_qty > ?').run(left, now(), packBatchId, left)
  return { left, jarIds }
}

// Puts the jars of a cancelled bill or order back in stock.
export async function returnJars({ orgId, channel, ref }) {
  await db.prepare("UPDATE jar_sales SET status = 'CANCELLED' WHERE org_id = ? AND channel = ? AND ref = ? AND status = 'ACTIVE'").run(orgId, channel, ref)
}
