import { formatAddress, officeSeeds, sampleAddress } from '../config/sampleData.js'
import { pgDdl } from './ddl.js'

// Addresses of keepers, offices of the KVIC hierarchy, and the public shop (listings and an index of orders).
// Buyer names, phone numbers and delivery addresses are NOT here: they live in the seller's private schema.
export async function ensureDirectorySchema(db, addColumn) {
  await addColumn('organizations', 'address_line', 'TEXT')
  await addColumn('organizations', 'locality', 'TEXT')
  await addColumn('organizations', 'district', 'TEXT')
  await addColumn('organizations', 'pincode', 'TEXT')
  await addColumn('organizations', 'upi_id', 'TEXT')
  await addColumn('organizations', 'address_sample', 'INTEGER NOT NULL DEFAULT 0')

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
  `))
  await db.refresh()

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
