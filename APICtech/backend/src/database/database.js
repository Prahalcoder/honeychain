import bcrypt from 'bcryptjs'

import { REGIONS, regionalUsername, stateUsername } from '../config/regions.js'
import { createHandle, driver } from './connection.js'
import { FORBID_CHANGE, immutable, lockDown, pgDdl } from './ddl.js'

// Common secure database: identity, organisation registry, review queues, the audit trail and the
// shared blockchain. Company production and finance records live in their own private schemas
// (see services/companyDb.js). Runs on hosted Postgres (Supabase) or embedded Postgres.
const db = createHandle()

await driver.exec(FORBID_CHANGE)

await db.exec(pgDdl(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER PRIMARY KEY,
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    farm_name TEXT DEFAULT '',
    farm_location TEXT DEFAULT '',
    business_name TEXT DEFAULT '',
    gstin TEXT DEFAULT '',
    business_address TEXT DEFAULT '',
    contact_email TEXT DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS hives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hive_code TEXT UNIQUE NOT NULL,
    location TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    device_connected INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_code TEXT UNIQUE NOT NULL,
    hive_code TEXT NOT NULL,
    quantity_kg REAL NOT NULL,
    honey_type TEXT,
    harvest_date TEXT,
    status TEXT DEFAULT 'CREATED',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS laboratory_tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL,
    lab_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    certificate_reference TEXT,
    results_json TEXT,
    tested_at TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (batch_id) REFERENCES batches(id)
  );

  CREATE TABLE IF NOT EXISTS custody_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    from_party_type TEXT,
    from_party_id TEXT,
    to_party_type TEXT,
    to_party_id TEXT,
    quantity_kg REAL NOT NULL,
    metadata_json TEXT,
    blockchain_tx_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (batch_id) REFERENCES batches(id)
  );

  CREATE TABLE IF NOT EXISTS custody_balances (
    batch_id INTEGER NOT NULL,
    party_type TEXT NOT NULL,
    party_id TEXT NOT NULL,
    quantity_kg REAL NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (batch_id, party_type, party_id),
    FOREIGN KEY (batch_id) REFERENCES batches(id)
  );

  CREATE TABLE IF NOT EXISTS api_clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_name TEXT NOT NULL,
    client_type TEXT NOT NULL,
    api_key_hash TEXT UNIQUE NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS organizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_code TEXT UNIQUE NOT NULL,
    organization_type TEXT NOT NULL,
    legal_name TEXT NOT NULL,
    madhukranti_id TEXT,
    fssai_license TEXT,
    gstin TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS pack_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pack_batch_code TEXT UNIQUE NOT NULL,
    batch_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    jar_size_grams INTEGER NOT NULL,
    quantity_to_pack INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (batch_id) REFERENCES batches(id)
  );

  CREATE TABLE IF NOT EXISTS packs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pack_id TEXT UNIQUE NOT NULL,
    pack_batch_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (pack_batch_id) REFERENCES pack_batches(id)
  );

  CREATE TABLE IF NOT EXISTS traceability_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_by INTEGER,
    prev_hash TEXT NOT NULL,
    current_hash TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

`))

// ---------------------------------------------------------------------------
// Migrations for databases created before roles, organisations and blocks.
// ---------------------------------------------------------------------------
// Adds a column to a table that an earlier version created without it.
async function addColumn(table, column, definition) {
  await await db.exec(pgDdl(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${pgDdl(definition)}`))
}

await addColumn('users', 'active', 'INTEGER NOT NULL DEFAULT 1')
await addColumn('users', 'state', 'TEXT')
await addColumn('users', 'region', 'TEXT')
await addColumn('users', 'last_login_at', 'TEXT')

// madhukranti_id doubles as the registration number issued by KVIC or by the
// beekeeper's own organisation; registration_body says who issued it.
await addColumn('organizations', 'owner_user_id', 'INTEGER')
await addColumn('organizations', 'registration_body', 'TEXT')
await addColumn('organizations', 'state', 'TEXT')
await addColumn('organizations', 'region', 'TEXT')
await addColumn('organizations', 'reviewed_by', 'INTEGER')
await addColumn('organizations', 'reviewed_at', 'TEXT')
await addColumn('organizations', 'review_note', 'TEXT')
await addColumn('organizations', 'private_db_file', 'TEXT')

await addColumn('batches', 'org_id', 'INTEGER')

await db.exec(pgDdl(`
  CREATE INDEX IF NOT EXISTS idx_batches_org ON batches(org_id);
  CREATE INDEX IF NOT EXISTS idx_organizations_scope ON organizations(state, region, status);
  CREATE INDEX IF NOT EXISTS idx_events_entity ON traceability_events(entity_type, entity_id);

  CREATE TABLE IF NOT EXISTS lab_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_test_id INTEGER NOT NULL UNIQUE,
    batch_id INTEGER NOT NULL,
    org_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    reviewed_by INTEGER,
    reviewed_at TEXT,
    review_note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lab_test_id) REFERENCES laboratory_tests(id),
    FOREIGN KEY (batch_id) REFERENCES batches(id),
    FOREIGN KEY (org_id) REFERENCES organizations(id)
  );

  -- Aggregate published by each company's private database. Only the monthly
  -- income total is shared, never the individual finance entries.
  CREATE TABLE IF NOT EXISTS monthly_reports (
    org_id INTEGER NOT NULL,
    month TEXT NOT NULL,
    income_inr REAL NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (org_id, month),
    FOREIGN KEY (org_id) REFERENCES organizations(id)
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id INTEGER NOT NULL,
    actor_role TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    detail_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (actor_user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_user_id, id);

  CREATE TABLE IF NOT EXISTS chain_validators (
    id TEXT PRIMARY KEY,
    public_key TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- A block seals a contiguous range of traceability events. Events cannot be
  -- updated, so blocks reference them by id range instead of marking them.
  CREATE TABLE IF NOT EXISTS chain_blocks (
    height INTEGER PRIMARY KEY,
    prev_hash TEXT NOT NULL,
    merkle_root TEXT NOT NULL,
    first_event_id INTEGER NOT NULL,
    last_event_id INTEGER NOT NULL,
    tx_count INTEGER NOT NULL,
    validator_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    block_hash TEXT UNIQUE NOT NULL,
    signature TEXT NOT NULL,
    FOREIGN KEY (validator_id) REFERENCES chain_validators(id)
  );


  -- Maps every ledger event to the organisation it belongs to so officers can
  -- filter the shared chain by company.
  CREATE VIEW IF NOT EXISTS event_org AS
  SELECT e.id AS event_id,
    COALESCE(ob.id, b1.org_id, b2.org_id, b3.org_id) AS org_id
  FROM traceability_events e
  LEFT JOIN organizations ob ON e.entity_type = 'ORGANIZATION' AND ob.organization_code = e.entity_id
  LEFT JOIN batches b1 ON e.entity_type = 'BATCH' AND b1.batch_code = e.entity_id
  LEFT JOIN pack_batches pb ON e.entity_type = 'PACK_BATCH' AND pb.pack_batch_code = e.entity_id
  LEFT JOIN batches b2 ON b2.id = pb.batch_id
  LEFT JOIN packs p ON e.entity_type = 'PACK' AND p.pack_id = e.entity_id
  LEFT JOIN pack_batches pb2 ON pb2.id = p.pack_batch_id
  LEFT JOIN batches b3 ON b3.id = pb2.batch_id;
`))

// The keeper first asks for a lab test; the certificate is attached later and
// only then does it reach the regional officer (lab_reviews).
await db.exec(pgDdl(`
  CREATE TABLE IF NOT EXISTS lab_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL,
    org_id INTEGER NOT NULL,
    lab_name TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'REQUESTED',
    lab_test_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (batch_id) REFERENCES batches(id),
    FOREIGN KEY (org_id) REFERENCES organizations(id)
  );

  -- Officer signing keys. The private key is stored encrypted with a key
  -- derived from the officer's password, so signing needs the password.
  CREATE TABLE IF NOT EXISTS officer_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    public_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    encrypted_private TEXT NOT NULL,
    salt TEXT NOT NULL,
    iv TEXT NOT NULL,
    tag TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`))

// Formal closure (deregistration) of an organisation, see services/closure.js
await db.exec(pgDdl(`
  CREATE TABLE IF NOT EXISTS closure_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'REQUESTED',
    initiated_by INTEGER NOT NULL,
    initiated_by_role TEXT NOT NULL,
    reason TEXT NOT NULL,
    declarations_json TEXT,
    checklist_json TEXT,
    completion_note TEXT,
    completed_by INTEGER,
    completed_at TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (org_id) REFERENCES organizations(id)
  );
`))

// Inspections / audits: an officer schedules a visit (the keeper gets at least a day's
// notice), then files a report with a checklist, grade and remarks afterwards.
await db.exec(pgDdl(`
  CREATE TABLE IF NOT EXISTS inspections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inspection_code TEXT UNIQUE,
    org_id INTEGER NOT NULL,
    initiated_by INTEGER NOT NULL,
    initiated_by_role TEXT NOT NULL,
    purpose TEXT NOT NULL,
    scheduled_date TEXT NOT NULL,
    scheduled_time TEXT,
    instructions TEXT,
    status TEXT NOT NULL DEFAULT 'SCHEDULED',
    notice_at TEXT NOT NULL,
    acknowledged_at TEXT,
    cancel_reason TEXT,
    conducted_on TEXT,
    inspector_name TEXT,
    present_person TEXT,
    checklist_json TEXT,
    physical_stock_kg REAL,
    chain_stock_kg REAL,
    grade TEXT,
    outcome TEXT,
    remarks TEXT,
    corrective_actions TEXT,
    corrective_due TEXT,
    internal_note TEXT,
    reported_by INTEGER,
    reported_at TEXT,
    closure_notice_at TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (org_id) REFERENCES organizations(id)
  );
`))
await addColumn('closure_requests', 'inspection_id', 'INTEGER')

// Help desk tickets: a conversation between a keeper and their regional officer, with
// hand-overs to the state office and (with the state officer's approval) the central office.
await db.exec(pgDdl(`
  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_code TEXT NOT NULL,
    org_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    subject TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    level TEXT NOT NULL DEFAULT 'REGIONAL',
    keeper_seen_id INTEGER NOT NULL DEFAULT 0,
    officer_seen_id INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    closed_at TEXT,
    closed_by INTEGER,
    FOREIGN KEY (org_id) REFERENCES organizations(id)
  );

  CREATE TABLE IF NOT EXISTS ticket_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL,
    sender_type TEXT NOT NULL,
    sender_id INTEGER,
    sender_name TEXT,
    body TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'PUBLIC',
    kind TEXT NOT NULL DEFAULT 'MESSAGE',
    created_at TEXT NOT NULL,
    FOREIGN KEY (ticket_id) REFERENCES tickets(id)
  );

  CREATE TABLE IF NOT EXISTS ticket_escalations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL,
    target TEXT NOT NULL,
    reason TEXT NOT NULL,
    requested_by INTEGER NOT NULL,
    status TEXT NOT NULL,
    decided_by INTEGER,
    decision_note TEXT,
    decided_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (ticket_id) REFERENCES tickets(id)
  );
`))

// Loose honey sold to wholesalers: quantities only, so a batch's QR jar limit knows what is gone.
await db.exec(pgDdl(`
  CREATE TABLE IF NOT EXISTS loose_sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_code TEXT NOT NULL,
    org_id INTEGER NOT NULL,
    batch_id INTEGER NOT NULL,
    grams INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    FOREIGN KEY (batch_id) REFERENCES batches(id)
  );
`))

// Notice board (announcements) and the keepers' help desk.
await db.exec(pgDdl(`
  CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id INTEGER NOT NULL,
    author_role TEXT NOT NULL,
    author_state TEXT,
    author_region TEXT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'NORMAL',
    audience_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    withdrawn_at TEXT,
    FOREIGN KEY (author_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS support_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    reply TEXT,
    replied_by INTEGER,
    replied_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (org_id) REFERENCES organizations(id)
  );
`))

await addColumn('lab_reviews', 'ai_analysis_json', 'TEXT')
await addColumn('lab_reviews', 'signed_payload', 'TEXT')
await addColumn('lab_reviews', 'signature', 'TEXT')
await addColumn('lab_reviews', 'signing_key_id', 'INTEGER')
await addColumn('lab_reviews', 'signed_at', 'TEXT')
// Optional scanned copy of the lab certificate (PDF, up to 10 MB).
await addColumn('lab_reviews', 'document_file', 'TEXT')
await addColumn('lab_reviews', 'document_name', 'TEXT')
await addColumn('lab_reviews', 'document_size', 'INTEGER')
await addColumn('lab_reviews', 'document_sha256', 'TEXT')
await addColumn('lab_reviews', 'document_uploaded_at', 'TEXT')

// The ledger, the blocks, the validators and the audit log can be added to but never changed.
await db.exec(`
  ${immutable('traceability_events', 'traceability ledger is immutable')}
  ${immutable('chain_blocks', 'blockchain is immutable')}
  ${immutable('chain_validators', 'blockchain is immutable')}
  ${immutable('audit_log', 'audit log is immutable')}
`)

// ---------------------------------------------------------------------------
// Seed data: one officer for each admin level (no beekeeper accounts).
// Change these passwords before any real deployment.
// ---------------------------------------------------------------------------
const seeds = [{ username: 'kvic.head', password: 'kvic@12345', name: 'KVIC Head Office', role: 'KVIC_HEAD' }]
// One state officer for every state, so each state has someone above its regional officers.
for (const state of Object.keys(REGIONS)) {
  seeds.push({ username: stateUsername(state), password: 'state@12345', name: `State Officer, ${state}`, role: 'STATE_OFFICER', state })
}
// One regional officer for every region a keeper can register in, so every
// registration has someone who can see and decide it. Login: region.<name>.
for (const [state, regions] of Object.entries(REGIONS)) {
  for (const region of regions) {
    seeds.push({ username: regionalUsername(region), password: 'region@12345', name: `Regional Officer, ${region}`, role: 'REGIONAL_OFFICER', state, region })
  }
}

const known = new Set((await db.prepare('SELECT username FROM users').all()).map((row) => row.username))
const missing = seeds.filter((seed) => !known.has(seed.username))

for (let start = 0; start < missing.length; start += 50) {
  const batch = missing.slice(start, start + 50)
  await db.prepare(`
    INSERT INTO users (username, password, name, role, state, region)
    VALUES ${batch.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}
  `).run(...batch.flatMap((seed) => [seed.username, bcrypt.hashSync(seed.password, 10), seed.name, seed.role, seed.state ?? null, seed.region ?? null]))
}

// No demo beekeeper is seeded: every company registers through the keeper app.

await db.refresh()
await lockDown('public')

export default db

