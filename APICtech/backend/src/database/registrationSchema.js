import { pgDdl } from './ddl.js'

// Registration profiles (the Madhukranti-style details behind each company), the jar scan log used to spot
// cloned QR codes, and the bulk purchase offers wholesalers send to beekeepers. All in the common schema: both
// sides of an offer need to see it, and a scan can come from any phone in the country.
export async function ensureRegistrationSchema(db, addColumn) {
  await db.exec(pgDdl(`
    -- One row per company: who registered, how, and the beekeeping / trading details they declared. Identity
    -- numbers are validated at registration, but only the last 4 digits of an Aadhaar or bank account are kept.
    CREATE TABLE IF NOT EXISTS organization_profiles (
      org_id INTEGER PRIMARY KEY,
      applicant_category TEXT NOT NULL,
      applicant_name TEXT,
      father_husband_name TEXT,
      dob TEXT,
      gender TEXT,
      education TEXT,
      social_category TEXT,
      aadhaar_last4 TEXT,
      pan TEXT,
      alt_phone TEXT,
      entity_kind TEXT,
      entity_registration_no TEXT,
      entity_registration_date TEXT,
      cin TEXT,
      members_count INTEGER,
      authorised_name TEXT,
      authorised_designation TEXT,
      authorised_aadhaar_last4 TEXT,
      nominee_name TEXT,
      nominee_dob TEXT,
      nominee_relation TEXT,
      bank_holder TEXT,
      bank_name TEXT,
      ifsc TEXT,
      account_last4 TEXT,
      business_state TEXT,
      business_district TEXT,
      business_address TEXT,
      details_json TEXT NOT NULL DEFAULT '{}',
      is_sample INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (org_id) REFERENCES organizations(id)
    );

    -- Every consumer scan of a jar's QR code on the public verify page. device_id is a random id the buyer's
    -- browser keeps; the location is only what the buyer chose to share, rounded to about a kilometre.
    CREATE TABLE IF NOT EXISTS qr_scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pack_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      ip_hash TEXT,
      latitude REAL,
      longitude REAL,
      accuracy_m REAL,
      scanned_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_qr_scans_pack ON qr_scans(pack_id, scanned_at);

    -- A jar whose code looks copied onto other jars (see services/qrGuard.js), for a KVIC officer to decide on.
    CREATE TABLE IF NOT EXISTS jar_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pack_id TEXT NOT NULL,
      org_id INTEGER,
      reason TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'AUTO',
      detail_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      created_at TEXT NOT NULL,
      resolved_by INTEGER,
      resolved_at TEXT,
      resolution_note TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_jar_alerts_status ON jar_alerts(status, org_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_jar_alerts_open ON jar_alerts(pack_id, reason) WHERE status = 'OPEN';

    -- A registered wholesaler's offer to buy loose honey from one batch of a beekeeper. Accepting it records a
    -- normal loose sale in the keeper's books (bill, custody hand-over on the chain) and fills in sale_code.
    CREATE TABLE IF NOT EXISTS purchase_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_code TEXT UNIQUE NOT NULL,
      trader_org_id INTEGER NOT NULL,
      keeper_org_id INTEGER NOT NULL,
      batch_id INTEGER NOT NULL,
      quantity_kg REAL NOT NULL CHECK (quantity_kg > 0),
      offer_price_per_kg REAL NOT NULL CHECK (offer_price_per_kg > 0),
      pickup_date TEXT,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      sale_code TEXT,
      invoice_number TEXT,
      decided_note TEXT,
      created_at TEXT NOT NULL,
      decided_at TEXT,
      FOREIGN KEY (trader_org_id) REFERENCES organizations(id),
      FOREIGN KEY (keeper_org_id) REFERENCES organizations(id),
      FOREIGN KEY (batch_id) REFERENCES batches(id)
    );
    CREATE INDEX IF NOT EXISTS idx_purchase_requests_keeper ON purchase_requests(keeper_org_id, status);
    CREATE INDEX IF NOT EXISTS idx_purchase_requests_trader ON purchase_requests(trader_org_id, status);
  `))
  await db.refresh()

  // Registration documents can now be a photo (bee colonies, passport photo) as well as a PDF.
  await addColumn('organization_documents', 'content_type', "TEXT NOT NULL DEFAULT 'application/pdf'")
}
