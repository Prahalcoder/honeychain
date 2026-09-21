// Honey Chain data inspector for the jury.
//
// Reads the REAL database, read-only, and produces ONE self-contained HTML page to show:
//   1. the common database the admin app uses (Postgres, schema "public"),
//   2. every company's separate private database (its own schema, which the admin API never opens),
//   3. the shared ledger, re-verified independently (hashes, Merkle roots, signatures),
//   4. the HoneyChain smart contract, read straight from the chain RPC: contract, events, transactions,
//      the wallets that signed them and the queue of what was sent.
//
// It connects with the same DATABASE_URL as the API (APICtech/backend/.env), so it shows exactly what
// the Supabase dashboard shows. Nothing is generated or seeded.
//
//   node tools/jury-explorer.mjs                 writes Honey-Chain-Data-Explorer.html
//   node tools/jury-explorer.mjs --live [port]   serves it, refreshed on every reload
//   node tools/jury-explorer.mjs --embedded      inspect the in-process test database (data/postgres)
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const backend = path.join(root, 'APICtech', 'backend')
const requireBackend = createRequire(path.join(backend, 'package.json'))
const chainDir = path.join(root, 'blockchain')

// The backend's .env holds DATABASE_URL and the chain settings.
try { requireBackend('dotenv').config({ path: path.join(backend, '.env'), quiet: true }) } catch { /* no .env */ }
const pg = requireBackend('pg')
pg.types.setTypeParser(20, Number)
pg.types.setTypeParser(1700, Number)

const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }

const OUT_FILE = path.resolve(flag('--out') || path.join(root, 'Honey-Chain-Data-Explorer.html'))
const EMBEDDED = args.includes('--embedded')

// One tiny client interface over a hosted Postgres or the embedded one.
async function openDatabase() {
  // Same default as the API: the Postgres server on this computer (started by npm start).
  const url = process.env.DATABASE_URL || `postgresql://postgres:postgres@127.0.0.1:${process.env.LOCAL_PG_PORT || 54329}/honeychain`
  if (!EMBEDDED) {
    const local = /localhost|127\.0\.0\.1/.test(url)
    const client = new pg.Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } })
    try { await client.connect() } catch (error) { throw new Error(`Cannot reach the database (${error.message}). Is "npm start" running?`) }
    await client.query('SET default_transaction_read_only = on')
    const host = new URL(url).host
    return { label: `${local ? 'local Postgres' : 'Postgres'} at ${host}`, query: async (sql, params = []) => (await client.query(sql, params)).rows, close: () => client.end() }
  }

  const { PGlite, types } = requireBackend('@electric-sql/pglite')
  const dir = path.resolve(process.env.PGLITE_DIR || path.join(process.env.DATA_DIR || path.join(backend, 'data'), 'postgres'))
  const lite = new PGlite(dir, { parsers: { [types.INT8]: Number, [types.NUMERIC]: Number } })
  return { label: 'embedded Postgres (PGlite)', query: async (sql, params = []) => (await lite.query(sql, params)).rows, close: () => lite.close() }
}

const SENSITIVE = /^(password|encrypted_private|salt|iv|tag|private_key|secret)$/i
const CATEGORIES = {
  Identity: ['users', 'user_settings', 'organizations', 'officer_keys', 'api_clients'],
  Approvals: ['lab_requests', 'lab_reviews', 'laboratory_tests', 'closure_requests', 'inspections', 'announcements', 'support_requests', 'tickets', 'ticket_messages', 'ticket_escalations'],
  Blockchain: ['traceability_events', 'chain_blocks', 'chain_validators', 'chain_outbox', 'chain_wallets', 'chain_meta'],
  Registry: ['batches', 'loose_sales', 'pack_batches', 'packs', 'custody_balances', 'custody_transfers', 'custody_events', 'ipfs_objects', 'lab_documents'],
  Audit: ['audit_log'],
  Reports: ['monthly_reports'],
}
const DESCRIPTIONS = {
  users: 'Every login: keepers, regional, state and KVIC officers. Passwords are stored only as bcrypt hashes.',
  user_settings: 'Contact and business details each keeper entered.',
  organizations: 'Registered companies, their licence numbers, jurisdiction and approval status. Points to the private database file.',
  officer_keys: 'Each officer\'s signing key pair. The private key is encrypted with the officer\'s own password.',
  lab_requests: 'Lab tests keepers asked for.', lab_reviews: 'Lab certificates waiting for, or decided by, an officer, with the AI analysis and the digital signature.',
  laboratory_tests: 'Lab certificate details shared by keepers.', closure_requests: 'Formal company closures and their government-formalities checklists.',
  inspections: 'Scheduled inspections and the officers\' visit reports (grade, checklist, remarks).', announcements: 'Notice board messages and who each one is addressed to.',
  support_requests: 'Older one-shot questions to the regional officer (replaced by tickets).', tickets: 'Help desk conversations: each keeper question is a ticket owned by the regional officer, who alone closes it.', ticket_messages: 'Messages in a ticket, including internal notes that keepers never see.', ticket_escalations: 'Hand-overs to the state office, and requests to the central office that need the state officer’s approval.',
  traceability_events: 'Every recorded action, each hash-linked to the one before it. Cannot be changed or deleted (database triggers).',
  chain_outbox: 'Every transaction the backend sent (or will send) to the smart contract, with its hash, block and retries.',
  chain_wallets: 'The signing account of every keeper and officer. Only the address is shown: the key is encrypted with AES-256-GCM.',
  chain_meta: 'Bookkeeping of the smart-contract link (resets detected, anchoring).',
  chain_blocks: 'Sealed blocks: Merkle root of their events, previous block hash, validator signature.', chain_validators: 'The validator node\'s public key.',
  batches: 'Harvest batches registered on the chain. Only the batch facts, not the keeper\'s notes.', pack_batches: 'Packaging runs and the jar limit per batch.', packs: 'One row per jar and its unique QR ID.',
  custody_balances: 'Who holds how much of each batch.', custody_transfers: 'Hand-overs down the supply chain.', custody_events: 'Every hand-over between keeper, distributor and retailer.', api_clients: 'API keys of connected devices and partner apps.',
  audit_log: 'Append-only record of officer actions.', monthly_reports: 'The ONLY finance data that leaves a company: one income total per month.',
  hives: 'The keeper\'s hives.', harvests: 'Harvest records with private notes.', finance_entries: 'Line-by-line income and expenses.', buyers: 'Customers.', invoices: 'Invoices with line items and GST.', meta: 'Bookkeeping for this database file.',
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
const GENESIS = '0'.repeat(64)

function merkleRoot(hashes) {
  if (hashes.length === 0) return sha256('')
  let level = hashes
  while (level.length > 1) {
    const next = []
    for (let i = 0; i < level.length; i += 2) next.push(sha256(level[i] + (level[i + 1] ?? level[i])))
    level = next
  }
  return level[0]
}

const hashBlock = (b) => sha256(JSON.stringify({
  height: b.height, prevHash: b.prev_hash, merkleRoot: b.merkle_root, firstEventId: b.first_event_id,
  lastEventId: b.last_event_id, txCount: b.tx_count, validatorId: b.validator_id, timestamp: b.timestamp,
}))

function cell(column, value) {
  if (value === null || value === undefined) return null
  if (SENSITIVE.test(column)) return `hidden (${String(value).length} characters)`
  if (Buffer.isBuffer(value)) return `binary ${value.length} bytes`
  const text = typeof value === 'string' ? value : String(value)
  return text.length > 140 ? `${text.slice(0, 137)}…` : text
}

async function describeSchema(db, schema, { sampleRows = 12 } = {}) {
  const tables = await db.query("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name", [schema])
  const keys = await db.query(`SELECT kcu.table_name AS t, kcu.column_name AS c FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1`, [schema])
  const isKey = new Set(keys.map((row) => `${row.t}.${row.c}`))

  const result = []
  for (const { name } of tables) {
    const columns = (await db.query('SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position', [schema, name]))
      .map((column) => ({ name: column.name, type: column.type.toUpperCase(), key: isKey.has(`${name}.${column.name}`), sensitive: SENSITIVE.test(column.name) }))
    const count = (await db.query(`SELECT COUNT(*) AS n FROM "${schema}"."${name}"`))[0].n
    const rows = (await db.query(`SELECT * FROM "${schema}"."${name}" ORDER BY ctid DESC LIMIT ${sampleRows}`))
      .map((row) => columns.map((column) => cell(column.name, row[column.name])))
    const category = Object.entries(CATEGORIES).find(([, names]) => names.includes(name))?.[0] || 'Other'
    result.push({ name, category, description: DESCRIPTIONS[name] || '', count, columns, rows })
  }
  return result
}

async function verifyChain(db) {
  const events = await db.query('SELECT * FROM traceability_events ORDER BY id ASC')
  const blocks = await db.query('SELECT * FROM chain_blocks ORDER BY height ASC')
  const validators = new Map((await db.query('SELECT id, public_key FROM chain_validators')).map((row) => [row.id, row.public_key]))
  const problems = []

  let expected = GENESIS
  const eventOk = new Map()
  for (const event of events) {
    const recomputed = sha256(JSON.stringify({
      entityType: event.entity_type, entityId: event.entity_id, eventType: event.event_type, payloadJson: event.payload_json,
      createdBy: event.created_by, prevHash: event.prev_hash, createdAt: event.created_at,
    }))
    const ok = event.prev_hash === expected && recomputed === event.current_hash
    eventOk.set(event.id, ok)
    if (!ok) problems.push(`Event #${event.id}: ${event.prev_hash === expected ? 'hash does not recompute' : 'link to previous event is broken'}`)
    expected = event.current_hash
  }

  const byId = new Map(events.map((event) => [event.id, event]))
  const checked = []
  let previous = null
  for (const block of blocks) {
    const inside = previous ? events.filter((event) => event.id > previous.last_event_id && event.id <= block.last_event_id) : []
    const checks = {
      height: block.height === (previous ? previous.height + 1 : 0),
      previousHash: block.prev_hash === (previous ? previous.block_hash : GENESIS),
      transactions: inside.length === block.tx_count,
      merkle: merkleRoot(inside.map((event) => event.current_hash)) === block.merkle_root,
      blockHash: hashBlock(block) === block.block_hash,
      signature: false,
    }
    const key = validators.get(block.validator_id)
    try { checks.signature = Boolean(key) && crypto.verify(null, Buffer.from(block.block_hash, 'hex'), crypto.createPublicKey(key), Buffer.from(block.signature, 'base64')) } catch { checks.signature = false }
    const ok = Object.values(checks).every(Boolean)
    if (!ok) problems.push(`Block #${block.height}: ${Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(', ')} failed`)
    checked.push({
      height: block.height, prevHash: block.prev_hash, merkleRoot: block.merkle_root, blockHash: block.block_hash, txCount: block.tx_count,
      validator: block.validator_id, timestamp: block.timestamp, signature: block.signature, checks, ok,
      events: inside.map((event) => ({ id: event.id, type: event.event_type, entity: `${event.entity_type} ${event.entity_id}`, hash: event.current_hash, prev: event.prev_hash, at: event.created_at, payload: event.payload_json, ok: eventOk.get(event.id) })),
    })
    previous = block
  }

  return {
    valid: problems.length === 0,
    problems,
    events: events.length,
    blocks: blocks.length,
    validators: [...validators].map(([id, pem]) => ({ id, fingerprint: sha256(pem).slice(0, 32) })),
    chain: checked.slice(-60),
    hidden: Math.max(0, checked.length - 60),
    orphanEvents: events.filter((event) => !blocks.some((block) => event.id <= block.last_event_id)).length,
    known: byId.size,
  }
}

async function privateDatabases(db) {
  const schemas = await db.query("SELECT schema_name AS name FROM information_schema.schemata WHERE schema_name LIKE 'co\\_%' OR schema_name LIKE 'archive\\_%' ORDER BY schema_name")
  const found = []

  for (const { name } of schemas) {
    const archived = name.startsWith('archive_')
    const code = (archived ? name.slice('archive_'.length).replace(/_\d{10,}$/, '') : name.slice(3)).toUpperCase().replace(/_/g, '-')
    const org = (await db.query('SELECT id, legal_name, organization_code, status, state, region FROM organizations WHERE organization_code = $1', [code]))[0]
    const tables = await describeSchema(db, name)
    const bytes = (await db.query("SELECT COALESCE(SUM(pg_total_relation_size(c.oid)), 0) AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relkind = 'r'", [name]))[0].n

    const income = tables.some((table) => table.name === 'finance_entries')
      ? await db.query(`SELECT substr(entry_date, 1, 7) AS month, COALESCE(SUM(CASE WHEN type = 'INCOME' THEN amount_inr END), 0) AS income, COUNT(*) AS entries FROM "${name}".finance_entries GROUP BY 1 ORDER BY 1 DESC`)
      : []
    const shared = org ? await db.query('SELECT month, income_inr FROM monthly_reports WHERE org_id = $1 ORDER BY month DESC', [org.id]) : []

    found.push({
      file: `schema ${name}`, state: archived ? 'ARCHIVED after closure' : 'ACTIVE', bytes,
      organization: org || { legal_name: '(not found in the common database)', organization_code: code },
      tables, isolation: { privateIncome: income, sharedMonthly: shared },
    })
  }
  return found
}

const withTimeout = (promise, ms = 4000) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('the chain did not answer')), ms))])

// Reads the smart contract straight from the chain: nothing here comes from the database.
async function collectOnChain(db) {
  const rpc = process.env.CHAIN_RPC_URL || 'http://127.0.0.1:8545'
  const result = { rpc, reachable: false, error: '', outbox: [], wallets: [], events: [], transactions: [], ledgerHead: null }

  const hasTable = async (name) => (await db.query("SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1", [name])).length > 0
  if (await hasTable('chain_outbox')) result.outbox = await db.query('SELECT id, kind, ref, status, tx_hash, block_number, attempts, last_error, updated_at FROM chain_outbox ORDER BY id DESC LIMIT 80')
  if (await hasTable('chain_wallets')) result.wallets = await db.query('SELECT w.address, u.username, u.role, w.created_at FROM chain_wallets w LEFT JOIN users u ON u.id = w.user_id ORDER BY w.created_at DESC')
  const head = (await db.query('SELECT height, block_hash FROM chain_blocks ORDER BY height DESC LIMIT 1'))[0]
  result.ledgerHead = head ? { height: head.height, hash: head.block_hash } : null

  let ethers
  try { ethers = createRequire(path.join(chainDir, 'package.json'))('ethers') } catch { result.error = 'The blockchain package is not installed. Run npm start once, or npm install inside blockchain/.'; return result }

  const artifactFile = path.join(chainDir, 'artifacts', 'HoneyChain.json')
  if (!fs.existsSync(artifactFile)) { result.error = 'The contract is not compiled yet (blockchain/artifacts/HoneyChain.json).'; return result }
  const abi = JSON.parse(fs.readFileSync(artifactFile, 'utf8')).abi
  const iface = new ethers.Interface(abi)
  const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: false, batchMaxCount: 1 })

  try {
    const network = await withTimeout(provider.getNetwork())
    result.chainId = Number(network.chainId)
    result.blockNumber = await withTimeout(provider.getBlockNumber())
    result.explorer = (process.env.CHAIN_EXPLORER_URL || { 80002: 'https://amoy.polygonscan.com', 137: 'https://polygonscan.com', 11155111: 'https://sepolia.etherscan.io' }[result.chainId] || '').replace(/\/$/, '') || null
    result.reachable = true

    const deployFile = path.join(chainDir, 'deployments', `${result.chainId}.json`)
    const deployed = fs.existsSync(deployFile) ? JSON.parse(fs.readFileSync(deployFile, 'utf8')) : null
    result.contract = process.env.HONEYCHAIN_CONTRACT || deployed?.address || null
    result.deployment = deployed
    if (!result.contract) { result.error = 'No contract address is recorded for this chain.'; return result }

    result.hasCode = (await withTimeout(provider.getCode(result.contract))) !== '0x'
    if (!result.hasCode) { result.error = 'No contract is deployed at that address on this chain.'; return result }

    const contract = new ethers.Contract(result.contract, abi, provider)
    const [height, anchoredHead] = await withTimeout(Promise.all([contract.anchoredHeight(), contract.anchoredHead()]))
    result.anchor = { height: Number(height), head: anchoredHead, matchesLedger: Boolean(head) && Number(height) > 0 && (await db.query('SELECT block_hash FROM chain_blocks WHERE height = $1', [Number(height)]))[0]?.block_hash === anchoredHead.slice(2) }

    const logs = await withTimeout(provider.getLogs({ address: result.contract, fromBlock: 0, toBlock: 'latest' }), 8000)
    result.eventCount = logs.length
    const recent = logs.slice(-150).reverse()
    result.events = recent.map((log) => {
      let name = 'unknown'
      const args = {}
      try {
        const parsed = iface.parseLog(log)
        name = parsed.name
        parsed.fragment.inputs.forEach((input, index) => { args[input.name] = parsed.args[index].toString() })
      } catch { /* not an event of this contract */ }
      return { block: log.blockNumber, tx: log.transactionHash, name, args }
    })

    const txs = [...new Set(recent.map((log) => log.transactionHash))].slice(0, 60)
    result.transactions = (await Promise.all(txs.map(async (hash) => {
      try {
        const [tx, receipt] = await Promise.all([withTimeout(provider.getTransaction(hash)), withTimeout(provider.getTransactionReceipt(hash))])
        let method = 'unknown'
        try { method = iface.parseTransaction({ data: tx.data }).name } catch { /* unknown selector */ }
        return { hash, block: tx.blockNumber, from: tx.from, method, gasUsed: receipt ? receipt.gasUsed.toString() : null, status: receipt ? receipt.status : null }
      } catch { return null }
    }))).filter(Boolean)
  } catch (error) {
    result.error = result.reachable ? error.message : `The chain is not running at ${rpc}. Start everything with npm start, then reload.`
  } finally {
    provider.destroy()
  }
  return result
}

export async function collect() {
  const db = await openDatabase()
  try {
    return {
      generatedAt: new Date().toISOString(),
      commonFile: `${db.label}, schema public`,
      dataDir: db.label,
      common: await describeSchema(db, 'public'),
      private: await privateDatabases(db),
      chain: await verifyChain(db),
      onchain: await collectOnChain(db),
      organizations: await db.query('SELECT status, COUNT(*) AS n FROM organizations GROUP BY status'),
    }
  } finally { await db.close() }
}

export async function render(live = false) {
  const css = fs.readFileSync(path.join(here, 'explorer.css'), 'utf8')
  const client = fs.readFileSync(path.join(here, 'explorer.client.js'), 'utf8')
  const data = JSON.stringify(await collect()).split('<').join('\u003c')

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Honey Chain Data Explorer</title>
<style>${css}</style></head>
<body><div id="app"></div>
<script>window.LIVE = ${live ? 'true' : 'false'}; window.DATA = ${data};</script>
<script>${client}</script></body></html>`
}

function openInBrowser(target) {
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', target], { stdio: 'ignore', detached: true }).unref()
    else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [target], { stdio: 'ignore', detached: true }).unref()
  } catch { /* the path is printed anyway */ }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (args.includes('--live')) {
    const port = Number(args[args.indexOf('--live') + 1]) || 5177
    http.createServer(async (request, response) => {
      try {
        const page = await render(true)
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        response.end(page)
      } catch (error) {
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        response.end(error.message)
      }
    }).listen(port, () => {
      console.log(`Honey Chain Data Explorer (live, read-only): http://localhost:${port}`)
      if (!args.includes('--no-open')) openInBrowser(`http://localhost:${port}`)
    })
  } else {
    try {
      fs.writeFileSync(OUT_FILE, await render(false))
      console.log(`Written: ${OUT_FILE}`)
      if (!args.includes('--no-open')) openInBrowser(OUT_FILE)
    } catch (error) {
      console.error(error.message)
      process.exit(1)
    }
  }
}
