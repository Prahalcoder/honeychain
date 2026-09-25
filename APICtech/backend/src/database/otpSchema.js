import { pgDdl } from './ddl.js'

// One-time codes (sign-in without a password, a keeper confirming a wholesaler's receipt) and the receipts a
// wholesaler records for honey received from a beekeeper. Codes are stored hashed, never in plain text.
export async function ensureOtpSchema(db) {
  await db.exec(pgDdl(`
    CREATE TABLE IF NOT EXISTS otp_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purpose TEXT NOT NULL,
      subject_key TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      meta_json TEXT NOT NULL DEFAULT '{}',
      attempts INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_otp_codes_subject ON otp_codes(purpose, subject_key, id);

    -- Honey a wholesaler says it received from a beekeeper, confirmed by an OTP sent to the keeper's phone.
    -- OTP_SENT -> (keeper's OTP entered) -> COMPLETED when the keeper's harvest is on record, otherwise
    -- AWAITING_HARVEST until the keeper records the harvest and attaches it. CANCELLED: withdrawn before confirming.
    CREATE TABLE IF NOT EXISTS wholesale_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_code TEXT UNIQUE NOT NULL,
      trader_org_id INTEGER NOT NULL,
      keeper_org_id INTEGER NOT NULL,
      keeper_name_entered TEXT NOT NULL,
      honey_type TEXT NOT NULL,
      quantity_kg REAL NOT NULL CHECK (quantity_kg > 0),
      price_per_kg REAL NOT NULL CHECK (price_per_kg > 0),
      received_date TEXT NOT NULL,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'OTP_SENT',
      batch_id INTEGER,
      sale_code TEXT,
      invoice_number TEXT,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      confirmed_at TEXT,
      completed_at TEXT,
      FOREIGN KEY (trader_org_id) REFERENCES organizations(id),
      FOREIGN KEY (keeper_org_id) REFERENCES organizations(id)
    );
    CREATE INDEX IF NOT EXISTS idx_wholesale_receipts_keeper ON wholesale_receipts(keeper_org_id, status);
    CREATE INDEX IF NOT EXISTS idx_wholesale_receipts_trader ON wholesale_receipts(trader_org_id, status);
  `))
  await db.refresh()
}
