import { formatAddress, officeSeeds, sampleAddress } from '../config/sampleData.js'
import { pgDdl } from './ddl.js'
import { ALL_HONEY_TYPES, seedMinimumPerKg } from '../config/honeyCatalogue.js'

// Addresses of keepers, offices of the KVIC hierarchy, and the public shop (listings and an index of orders).
// Buyer names, phone numbers and delivery addresses are NOT here: they live in the seller's private schema.
export async function ensureDirectorySchema(db, addColumn) {
  await addColumn('organizations', 'address_line', 'TEXT')
  await addColumn('organizations', 'locality', 'TEXT')
  await addColumn('organizations', 'district', 'TEXT')
  await addColumn('organizations', 'pincode', 'TEXT')
  await addColumn('organizations', 'upi_id', 'TEXT')
  await addColumn('organizations', 'address_sample', 'INTEGER NOT NULL DEFAULT 0')

  // jar_sales is new: on the first start with it, orders taken through the shop before it existed are counted below.
  const hadJarSales = Boolean(await db.prepare("SELECT 1 AS found FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'jar_sales'").get())

  await db.exec(pgDdl(`
    CREATE TABLE IF NOT EXISTS offices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      address_line TEXT NOT NULL,
      locality TEXT,
      district TEXT,
      pincode TEXT,
      email TEXT,
      is_sample INTEGER NOT NULL DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (level, state, region)
    );

    CREATE TABLE IF NOT EXISTS shop_listings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL,
      pack_batch_id INTEGER NOT NULL UNIQUE,
      title TEXT NOT NULL,
      jar_size_grams INTEGER NOT NULL,
      price_inr REAL NOT NULL CHECK (price_inr > 0),
      listed_qty INTEGER NOT NULL DEFAULT 0,
      stock_qty INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
      active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (org_id) REFERENCES organizations(id),
      FOREIGN KEY (pack_batch_id) REFERENCES pack_batches(id)
    );
    CREATE INDEX IF NOT EXISTS idx_shop_listings_org ON shop_listings(org_id, active);

    -- Which company holds an order, so the public tracking page can find it. No buyer details.
    CREATE TABLE IF NOT EXISTS shop_order_index (
      order_code TEXT PRIMARY KEY,
      org_id INTEGER NOT NULL,
      listing_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (org_id) REFERENCES organizations(id),
      FOREIGN KEY (listing_id) REFERENCES shop_listings(id)
    );
    CREATE INDEX IF NOT EXISTS idx_shop_order_index_org ON shop_order_index(org_id);

    -- Jars of a packaging run that left the stock: on a bill (BILL, ref = invoice number) or through the shop
    -- (SHOP, ref = order code). A cancelled bill or order sets the row to CANCELLED and the jars are back in stock.
    CREATE TABLE IF NOT EXISTS jar_sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL,
      pack_batch_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      channel TEXT NOT NULL,
      ref TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      FOREIGN KEY (org_id) REFERENCES organizations(id),
      FOREIGN KEY (pack_batch_id) REFERENCES pack_batches(id)
    );
    CREATE INDEX IF NOT EXISTS idx_jar_sales_lot ON jar_sales(pack_batch_id, status);
    CREATE INDEX IF NOT EXISTS idx_jar_sales_ref ON jar_sales(org_id, channel, ref);

    -- Settings the KVIC head office controls for every keeper: the standard GST on jars.
    CREATE TABLE IF NOT EXISTS platform_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_by INTEGER,
      updated_at TEXT
    );

    -- The lowest price per kg a keeper may charge for each honey type (before GST).
    CREATE TABLE IF NOT EXISTS price_guidance (
      honey_type TEXT PRIMARY KEY,
      min_price_per_kg REAL NOT NULL CHECK (min_price_per_kg > 0),
      updated_by INTEGER,
      updated_at TEXT
    );
  `))
  await db.refresh()

  // The jar QR codes (pack ids) put aside for an order once it is paid: no buyer details, only ids of jars.
  await addColumn('shop_order_index', 'jar_ids', 'TEXT')
  // The jar QR codes named on a bill line (one JSON list per row of jar_sales).
  await addColumn('jar_sales', 'jar_ids', 'TEXT')

  // A listing is either JAR (packaged, QR-coded, from a packaging run) or LOOSE (sold straight by the kilogram
  // from a lab-verified batch, no packaging step). LOOSE listings have no packaging run, so pack_batch_id is
  // relaxed to nullable and they instead point at the batch directly.
  await addColumn('shop_listings', 'kind', "TEXT NOT NULL DEFAULT 'JAR'")
  await addColumn('shop_listings', 'batch_id', 'INTEGER REFERENCES batches(id)')
  await db.exec(pgDdl('ALTER TABLE shop_listings ALTER COLUMN pack_batch_id DROP NOT NULL'))

  // Standard GST and the minimum prices: created once, later edits by the head office are never overwritten.
  await db.prepare("INSERT INTO platform_settings (key, value, updated_at) VALUES ('jar_gst_percent', '5', ?) ON CONFLICT (key) DO NOTHING").run(new Date().toISOString())
  for (const type of ALL_HONEY_TYPES) {
    await db.prepare('INSERT INTO price_guidance (honey_type, min_price_per_kg, updated_at) VALUES (?, ?, ?) ON CONFLICT (honey_type) DO NOTHING').run(type, seedMinimumPerKg(type), new Date().toISOString())
  }

  // Every listing already in the shop is brought up to the minimum of its honey type (JAR or LOOSE alike:
  // a LOOSE listing has no packaging run, so its batch is reached through l.batch_id instead of pb.batch_id).
  const listings = await db.prepare('SELECT l.id, l.price_inr, l.jar_size_grams, b.honey_type FROM shop_listings l LEFT JOIN pack_batches pb ON pb.id = l.pack_batch_id JOIN batches b ON b.id = COALESCE(pb.batch_id, l.batch_id)').all()
  for (const listing of listings) {
    const perKg = (await db.prepare('SELECT min_price_per_kg FROM price_guidance WHERE honey_type = ?').get(listing.honey_type))?.min_price_per_kg ?? seedMinimumPerKg('Other')
    const floor = Math.ceil((Number(perKg) * listing.jar_size_grams) / 1000)
    if (Number(listing.price_inr) < floor) await db.prepare('UPDATE shop_listings SET price_inr = ?, updated_at = ? WHERE id = ?').run(floor, new Date().toISOString(), listing.id)
  }

  // Jars already ordered through the shop (listed minus what is still on the shelf) leave the inventory too.
  if (!hadJarSales) {
    await db.exec(`
      INSERT INTO jar_sales (org_id, pack_batch_id, quantity, channel, ref, created_at)
      SELECT l.org_id, l.pack_batch_id, l.listed_qty - l.stock_qty, 'SHOP', 'EARLIER-' || CAST(l.id AS TEXT), CAST(NOW() AS TEXT)
      FROM shop_listings l WHERE l.listed_qty > l.stock_qty
    `)
  }

  // Offices: created once, real values (a later edit in the table) are never overwritten.
  for (const office of officeSeeds()) {
    await db.prepare(`
      INSERT INTO offices (level, state, region, name, address_line, locality, district, pincode, email, is_sample)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (level, state, region) DO NOTHING
    `).run(office.level, office.state, office.region, office.name, office.addressLine, office.locality, office.district, office.pincode, office.email, office.isSample)
  }

  // Companies registered before addresses existed get a made-up one, marked as a sample so the keeper knows to replace it.
  const missing = await db.prepare("SELECT id, organization_code, state, region, owner_user_id FROM organizations WHERE address_line IS NULL OR address_line = ''").all()
  for (const org of missing) {
    const address = sampleAddress(org.state, org.region, org.organization_code)
    await db.prepare('UPDATE organizations SET address_line = ?, locality = ?, district = ?, pincode = ?, address_sample = 1 WHERE id = ?')
      .run(address.addressLine, address.locality, address.district, address.pincode, org.id)
    // The older free-text fields on the profile follow the new address, so the two never disagree.
    await db.prepare("UPDATE user_settings SET business_address = ?, farm_location = ? WHERE user_id = ? AND COALESCE(business_address, '') = ''")
      .run(formatAddress({ ...address, state: org.state }), address.locality, org.owner_user_id)
  }
}
