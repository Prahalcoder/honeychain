// Moves the data of the earlier SQLite version (apictech.db + data/companies/*.db) into PostgreSQL.
//
//   npm run db:import-sqlite                 imports into the local database (a database without companies is wiped first)
//   npm run db:import-sqlite -- --force      wipes the Postgres data first, then imports
//   options: --sqlite <apictech.db>  --data <folder with companies/, lab-documents/, archive/>
//
// Stop "npm start" first (Ctrl+C). If the local database is not running, this script starts it for the
// import and stops it again afterwards. The SQLite files are only read (a copy is opened), never changed.
// Everything is copied as it is: users with their password hashes, organisations, batches, the whole
// hash-chained ledger and blocks (so it still verifies), each company's private tables, lab PDFs.
import 'dotenv/config'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import Database from 'better-sqlite3'

const here = path.dirname(fileURLToPath(import.meta.url))
const backendRoot = path.resolve(here, '..')
const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }

const SQLITE_FILE = path.resolve(flag('--sqlite') || process.env.DATABASE_FILE || path.join(backendRoot, 'apictech.db'))
const DATA = path.resolve(flag('--data') || process.env.DATA_DIR || path.join(backendRoot, 'data'))
const FORCE = args.includes('--force')

if (!fs.existsSync(SQLITE_FILE)) { console.error(`SQLite file not found: ${SQLITE_FILE}`); process.exit(1) }

// ------------------------------------------------------------------ make sure the database is up
const url = process.env.DATABASE_URL || `postgresql://postgres:postgres@127.0.0.1:${process.env.LOCAL_PG_PORT || 54329}/honeychain`
const target = new URL(url)
const isLocal = /^(127\.0\.0\.1|localhost)$/.test(target.hostname)
const port = Number(target.port || 5432)

const listening = () => new Promise((resolve) => {
  const socket = net.connect({ host: target.hostname, port })
  socket.once('connect', () => { socket.destroy(); resolve(true) })
  socket.once('error', () => resolve(false))
})

let startedHere = null
if (!(await listening())) {
  if (!isLocal) { console.error(`Cannot reach ${target.host}.`); process.exit(1) }
  console.log('Starting the local database for the import...')
  startedHere = spawn(process.execPath, [path.join(here, 'local-postgres.mjs')], { cwd: backendRoot, stdio: 'ignore' })
  for (let i = 0; i < 90 && !(await listening()); i++) await new Promise((resolve) => setTimeout(resolve, 1000))
  await new Promise((resolve) => setTimeout(resolve, 1500))
}

const stopLocal = () => {
  if (!startedHere) return
  spawnSync(process.execPath, [path.join(here, 'local-postgres.mjs'), 'stop'], { cwd: backendRoot, stdio: 'ignore' })
  startedHere.kill()
}

// The port can be open while Postgres is still recovering from an earlier forced stop: retry until it answers.
async function connectWhenReady() {
  let lastError = null
  for (let attempt = 0; attempt < 90; attempt++) {
    const candidate = new pg.Client({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } })
    try { await candidate.connect(); return candidate } catch (error) {
      lastError = error
      await candidate.end().catch(() => {})
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
  throw lastError
}
const client = await connectWhenReady()
pg.types.setTypeParser(20, Number)

// ------------------------------------------------------------------ guard, optional wipe
const hasTable = async (schema, name) => (await client.query('SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2', [schema, name])).rowCount > 0
// A database with no companies only holds what the app creates at start-up (officer logins, an empty ledger),
// so it is wiped automatically. One that already has companies is only replaced with --force.
let wipe = FORCE
if (await hasTable('public', 'organizations')) {
  const existing = (await client.query('SELECT COUNT(*)::int AS n FROM public.organizations')).rows[0].n
  if (existing > 0 && !FORCE) {
    console.error(`The database already holds ${existing} organisation(s). Run again with --force to wipe it first.`)
    await client.end(); stopLocal(); process.exit(1)
  }
  wipe = true
}
if (wipe) {
  const schemas = (await client.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'co\\_%' OR schema_name LIKE 'archive\\_%'")).rows
  for (const row of schemas) await client.query(`DROP SCHEMA "${row.schema_name}" CASCADE`)
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;')
  console.log('Existing Postgres data wiped.')
}
await client.end()

// ------------------------------------------------------------------ create the schema through the app's own code
process.env.DATABASE_URL = url
const { default: db } = await import('../src/database/database.js')
await import('../src/services/ipfs.js')
await import('../src/services/labDocuments.js')
await import('../src/services/chain.js')
const { getCompanyDb, archiveCompanyDb } = await import('../src/services/companyDb.js')
const { validateBlockchain } = await import('../src/services/blockchain.js')
const { closeDatabase } = await import('../src/database/connection.js')

const work = new pg.Client({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } })
await work.connect()

// A private copy of the SQLite files, so the live ones are never touched.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'honeychain-import-'))
const copyWithWal = (file) => {
  const out = path.join(temp, path.basename(file))
  for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(file + suffix)) fs.copyFileSync(file + suffix, out + suffix)
  return new Database(out, { readonly: false })
}
const source = copyWithWal(SQLITE_FILE)
const sqliteTables = (conn) => new Set(conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((row) => row.name))

async function targetColumns(schema, table) {
  return (await work.query('SELECT column_name AS name, is_identity = \'YES\' AS identity FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position', [schema, table])).rows
}

// Copies one table. Returns the number of rows.
async function copyTable(conn, schema, table) {
  const columns = await targetColumns(schema, table)
  const sourceColumns = new Set(conn.prepare(`PRAGMA table_info("${table}")`).all().map((column) => column.name))
  const common = columns.filter((column) => sourceColumns.has(column.name))
  if (!common.length) return 0

  const rows = conn.prepare(`SELECT ${common.map((column) => `"${column.name}"`).join(', ')} FROM "${table}"`).all()
  const perBatch = Math.max(1, Math.floor(30000 / common.length))
  const overriding = common.some((column) => column.identity) ? ' OVERRIDING SYSTEM VALUE' : ''

  for (let start = 0; start < rows.length; start += perBatch) {
    const batch = rows.slice(start, start + perBatch)
    const params = []
    const values = batch.map((row) => `(${common.map((column) => { params.push(row[column.name] ?? null); return `$${params.length}` }).join(', ')})`)
    await work.query(`INSERT INTO "${schema}"."${table}" (${common.map((column) => `"${column.name}"`).join(', ')})${overriding} VALUES ${values.join(', ')}`, params)
  }
  return rows.length
}

// Tables ordered so that every table comes after the ones it refers to.
async function orderedTables(schema) {
  const tables = (await work.query("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'", [schema])).rows.map((row) => row.name)
  const edges = (await work.query(`SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace WHERE c.contype = 'f' AND n.nspname = $1`, [schema])).rows
  const clean = (name) => name.replace(/^"?[^".]+"?\./, '').replace(/"/g, '')
  const parents = new Map(tables.map((name) => [name, new Set()]))
  for (const edge of edges) if (clean(edge.child) !== clean(edge.parent)) parents.get(clean(edge.child))?.add(clean(edge.parent))

  const done = []
  const remaining = new Set(tables)
  while (remaining.size) {
    const ready = [...remaining].filter((name) => [...parents.get(name)].every((parent) => !remaining.has(parent))).sort()
    if (!ready.length) { done.push(...[...remaining].sort()); break }
    for (const name of ready) { done.push(name); remaining.delete(name) }
  }
  return done
}

async function resetSequences(schema) {
  const tables = (await work.query("SELECT table_name AS name FROM information_schema.columns WHERE table_schema = $1 AND column_name = 'id' AND is_identity = 'YES'", [schema])).rows
  for (const { name } of tables) {
    await work.query(`SELECT setval(pg_get_serial_sequence('"${schema}"."${name}"', 'id'), COALESCE((SELECT MAX(id) FROM "${schema}"."${name}"), 0) + 1, false)`)
  }
}

const report = []

// ------------------------------------------------------------------ 1. the common tables
console.log(`Importing ${SQLITE_FILE}`)
const present = sqliteTables(source)
await work.query('BEGIN')
try {
  await work.query('DELETE FROM public.users')   // the officers created at start-up come back from the old data, with their old ids
  for (const table of await orderedTables('public')) {
    if (!present.has(table)) continue
    const count = await copyTable(source, 'public', table)
    if (count) report.push(`  public.${table.padEnd(24)} ${count} rows`)
  }
  await resetSequences('public')

  // Lab certificate PDFs used to be files; they now live in the database.
  const reviews = (await work.query("SELECT id, document_file FROM public.lab_reviews WHERE document_file IS NOT NULL AND document_file NOT LIKE 'db:%'")).rows
  let pdfs = 0
  for (const review of reviews) {
    const file = path.join(DATA, 'lab-documents', review.document_file)
    if (!fs.existsSync(file)) continue
    await work.query('INSERT INTO public.lab_documents (review_id, content) VALUES ($1, $2) ON CONFLICT (review_id) DO NOTHING', [review.id, fs.readFileSync(file)])
    await work.query('UPDATE public.lab_reviews SET document_file = $1 WHERE id = $2', [`db:${review.id}`, review.id])
    pdfs += 1
  }
  if (pdfs) report.push(`  lab certificate PDFs      ${pdfs} moved into the database`)

  const ipfsDir = path.join(DATA, 'ipfs')
  if (fs.existsSync(ipfsDir)) {
    let files = 0
    for (const name of fs.readdirSync(ipfsDir).filter((file) => file.endsWith('.json'))) {
      await work.query('INSERT INTO public.ipfs_objects (cid, body) VALUES ($1, $2) ON CONFLICT (cid) DO NOTHING', [name.replace(/\.json$/, ''), fs.readFileSync(path.join(ipfsDir, name), 'utf8')])
      files += 1
    }
    if (files) report.push(`  public metadata files     ${files}`)
  }
  await work.query('COMMIT')
} catch (error) {
  await work.query('ROLLBACK')
  throw error
}

// ------------------------------------------------------------------ 2. every company's private database
const COMPANY_TABLES = ['hives', 'harvests', 'buyers', 'finance_entries', 'invoices', 'honey_sales', 'meta']
const organizations = (await work.query('SELECT id, organization_code, legal_name, status FROM public.organizations ORDER BY id')).rows

for (const org of organizations) {
  const live = path.join(DATA, 'companies', `${org.organization_code}.db`)
  const archivedDir = path.join(DATA, 'archive')
  const archivedFile = fs.existsSync(archivedDir) ? fs.readdirSync(archivedDir).find((name) => name.startsWith(`${org.organization_code}-`) && name.endsWith('.db')) : null
  const file = fs.existsSync(live) ? live : archivedFile ? path.join(archivedDir, archivedFile) : null

  if (!file) { report.push(`  ${org.organization_code} (${org.legal_name}): no private file found, an empty private schema is created`) }
  const schema = `co_${org.organization_code.toLowerCase().replace(/-/g, '_')}`
  await getCompanyDb(org.organization_code)

  if (file) {
    const conn = copyWithWal(file)
    const have = sqliteTables(conn)
    await work.query('BEGIN')
    try {
      const parts = []
      for (const table of COMPANY_TABLES) {
        if (!have.has(table)) continue
        const count = await copyTable(conn, schema, table)
        if (count) parts.push(`${table} ${count}`)
      }
      await resetSequences(schema)
      await work.query('COMMIT')
      report.push(`  ${schema}: ${parts.join(', ') || 'no rows'}`)
    } catch (error) { await work.query('ROLLBACK'); throw error }
    conn.close()
  }

  const finalName = file === archivedFile ? await archiveCompanyDb(org.organization_code) : schema
  await work.query('UPDATE public.organizations SET private_db_file = $1 WHERE id = $2', [finalName || schema, org.id])
}

// ------------------------------------------------------------------ 3. check
const check = async (sql) => (await work.query(sql)).rows[0]
const users = await check("SELECT COUNT(*)::int AS n FROM public.users WHERE role = 'BEEKEEPER'")
const validation = await validateBlockchain()
const events = await check('SELECT COUNT(*)::int AS n FROM public.traceability_events')
const blocks = await check('SELECT COUNT(*)::int AS n FROM public.chain_blocks')

console.log(`\n${report.join('\n')}`)
console.log(`\nImported ${organizations.length} organisation(s), ${users.n} keeper login(s), ${events.n} ledger events in ${blocks.n} blocks.`)
console.log(`Ledger check: ${validation.valid ? 'the hash chain is intact' : `PROBLEM: ${validation.reason || JSON.stringify(validation)}`}`)
console.log('Keeper logins keep their old usernames and passwords.')

source.close()
fs.rmSync(temp, { recursive: true, force: true })
await work.end()
await closeDatabase()
stopLocal()
process.exit(validation.valid ? 0 : 1)
