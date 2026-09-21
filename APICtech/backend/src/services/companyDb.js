import { createHandle, inSchema, sqlExec, sqlQuery } from '../database/connection.js'
import { lockDown, pgDdl } from '../database/ddl.js'

// Every registered company gets its own private Postgres schema (co_<organisation code>). It holds
// day-to-day production and finance records and is never opened by the admin routes. Only aggregate
// figures and blockchain events leave it. In the Supabase dashboard each company shows up as its own
// schema, separate from the common tables.
const connections = new Map()
const TABLES = ['hives', 'harvests', 'finance_entries', 'buyers', 'honey_sales', 'invoices', 'shop_orders', 'meta']

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS hives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hive_code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    location TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS harvests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_code TEXT UNIQUE NOT NULL,
    hive_code TEXT NOT NULL,
    harvest_date TEXT NOT NULL,
    honey_type TEXT NOT NULL,
    quantity_kg REAL NOT NULL,
    location TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS finance_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_date TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('INCOME', 'EXPENSE')),
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_inr REAL NOT NULL CHECK (amount_inr > 0),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS buyers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    contact TEXT,
    gstin TEXT,
    address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Loose honey sold to a wholesaler (or other buyer) at a fixed price per kg. Prices and
  -- buyer details stay in this private file; only the quantity reaches the common database.
  CREATE TABLE IF NOT EXISTS honey_sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_code TEXT UNIQUE NOT NULL,
    buyer_id INTEGER NOT NULL,
    batch_code TEXT NOT NULL,
    quantity_grams INTEGER NOT NULL,
    price_per_kg REAL NOT NULL,
    amount_inr REAL NOT NULL,
    sale_date TEXT NOT NULL,
    invoice_id INTEGER,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    note TEXT,
    public_name INTEGER NOT NULL DEFAULT 1,
    party_type TEXT,
    party_id TEXT,
    cancel_reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (buyer_id) REFERENCES buyers(id)
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT UNIQUE NOT NULL,
    buyer_id INTEGER NOT NULL,
    batch_code TEXT,
    issue_date TEXT NOT NULL,
    due_date TEXT,
    lines_json TEXT NOT NULL,
    subtotal_inr REAL NOT NULL,
    gst_percent REAL NOT NULL DEFAULT 0,
    gst_inr REAL NOT NULL DEFAULT 0,
    total_inr REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending',
    paid_at TEXT,
    finance_entry_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (buyer_id) REFERENCES buyers(id)
  );

  -- Orders placed on the public "Sellers nearby" page. Buyer name, phone and delivery address stay in this
  -- private schema; the public tracking page finds an order through public.shop_order_index.
  CREATE TABLE IF NOT EXISTS shop_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_code TEXT UNIQUE NOT NULL,
    listing_id INTEGER NOT NULL,
    pack_batch_code TEXT,
    product_title TEXT NOT NULL,
    jar_size_grams INTEGER,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_inr REAL NOT NULL,
    total_inr REAL NOT NULL,
    buyer_name TEXT NOT NULL,
    buyer_phone TEXT NOT NULL,
    buyer_email TEXT,
    delivery_address TEXT NOT NULL,
    delivery_pincode TEXT NOT NULL,
    payment_status TEXT NOT NULL DEFAULT 'PENDING',
    payment_ref TEXT,
    paid_at TEXT,
    order_status TEXT NOT NULL DEFAULT 'PLACED',
    courier TEXT,
    tracking_ref TEXT,
    shipped_at TEXT,
    delivered_at TEXT,
    cancel_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`

export function companySchema(organizationCode) {
  if (!/^[A-Z0-9-]{4,40}$/.test(organizationCode)) {
    throw new Error('Invalid organization code')
  }

  return `co_${organizationCode.toLowerCase().replace(/-/g, '_')}`
}

export function getCompanyDb(organizationCode) {
  const schema = companySchema(organizationCode)
  if (connections.has(organizationCode)) return connections.get(organizationCode)

  const opening = (async () => {
    await inSchema(schema, pgDdl(SCHEMA))
    await lockDown(schema)
    const handle = createHandle({ schema, tables: TABLES })
    await handle.ready
    return handle
  })()

  connections.set(organizationCode, opening)
  opening.catch(() => connections.delete(organizationCode))
  return opening
}

export async function createCompanyDb(organizationCode) {
  await getCompanyDb(organizationCode)
  return companySchema(organizationCode)
}

// Closing a company keeps its private records: the schema is renamed to archive_..., for statutory
// retention, never dropped, and never opened by admins.
export async function archiveCompanyDb(organizationCode) {
  const schema = companySchema(organizationCode)
  connections.delete(organizationCode)

  const exists = (await sqlQuery('SELECT 1 FROM information_schema.schemata WHERE schema_name = $1', [schema])).rows.length > 0
  if (!exists) return null

  const archived = `archive_${schema.slice(3)}_${Date.now()}`
  await sqlExec(`ALTER SCHEMA "${schema}" RENAME TO "${archived}"`)
  return archived
}

export async function nextHiveCode(companyDb) {
  const highest = (await companyDb
    .prepare('SELECT hive_code FROM hives')
    .all())
    .reduce((max, row) => Math.max(max, Number(row.hive_code.slice(1)) || 0), 0)

  return `H${String(highest + 1).padStart(3, '0')}`
}
