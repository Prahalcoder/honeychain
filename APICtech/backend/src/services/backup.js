import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { driver, usingHostedDatabase } from '../database/connection.js'

// Database health and exports.
//
// The data itself lives in Postgres (Supabase). Supabase keeps its own backups (daily on the free
// plan, point-in-time on paid plans). This module adds two things on top:
//   - a health check of every schema (the common one and one per company): can it be read, how many
//     tables and rows, is the ledger table still there;
//   - a portable export: one JSON-lines file per table plus a manifest with a SHA-256 of every file,
//     so a copy of the data can be kept anywhere, and checked later.
const here = path.dirname(fileURLToPath(import.meta.url))
export const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(here, '../../backups'))
const KEEP = Number(process.env.BACKUP_KEEP || 14)
const EVERY_HOURS = Number(process.env.BACKUP_EVERY_HOURS || 24)

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')
const quote = (name) => `"${name.replace(/"/g, '""')}"`

export const databaseKind = () => driver.kind

// Every schema this application owns: public (common) plus co_* (companies) and archive_* (closed companies).
async function schemas() {
  const rows = (await driver.query(`
    SELECT schema_name FROM information_schema.schemata
    WHERE schema_name = 'public' OR schema_name LIKE 'co\\_%' OR schema_name LIKE 'archive\\_%'
    ORDER BY (schema_name = 'public') DESC, schema_name
  `, [])).rows
  return rows.map((row) => row.schema_name)
}

async function tablesOf(schema) {
  return (await driver.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name
  `, [schema])).rows.map((row) => row.table_name)
}

// Reads every schema. Returns one entry per schema: { name, tables, rows, result }.
export async function verifyDatabases() {
  const found = []

  for (const schema of await schemas()) {
    try {
      const tables = await tablesOf(schema)
      let rows = 0
      for (const table of tables) rows += (await driver.query(`SELECT COUNT(*) AS n FROM ${quote(schema)}.${quote(table)}`, [])).rows[0].n
      const missing = schema === 'public' && !tables.includes('traceability_events') ? 'the ledger table is missing' : null
      found.push({ name: schema === 'public' ? 'common' : schema, schema, tables: tables.length, rows, result: missing || 'ok' })
    } catch (error) {
      found.push({ name: schema, schema, tables: 0, rows: 0, result: `cannot read: ${error.message}` })
    }
  }
  return found
}

// Writes an export. `common` is the shared database handle (for the ledger head in the manifest).
export async function backupNow(common) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = path.join(BACKUP_DIR, stamp)
  fs.mkdirSync(target, { recursive: true })

  const files = []
  for (const schema of await schemas()) {
    const folder = path.join(target, schema)
    fs.mkdirSync(folder, { recursive: true })

    for (const table of await tablesOf(schema)) {
      // Secrets stay out of an export that may be copied around: wallet keys and officer signing keys.
      if (/^(chain_wallets|officer_keys)$/.test(table)) continue
      const rows = (await driver.query(`SELECT * FROM ${quote(schema)}.${quote(table)}`, [])).rows
      const body = Buffer.from(rows.map((row) => JSON.stringify(row, (_, value) => (Buffer.isBuffer(value) ? `base64:${value.toString('base64')}` : value))).join('\n'))
      fs.writeFileSync(path.join(folder, `${table}.jsonl`), body)
      files.push({ path: `${schema}/${table}.jsonl`, rows: rows.length, sha256: sha256(body), bytes: body.length })
    }
  }

  const head = await common.prepare('SELECT height, block_hash FROM chain_blocks ORDER BY height DESC LIMIT 1').get()
  const problems = (await verifyDatabases()).filter((item) => item.result !== 'ok')
  fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), database: driver.kind, ledgerHead: head || null, files, problems }, null, 2))

  const all = listBackups()
  for (const old of all.slice(KEEP)) fs.rmSync(path.join(BACKUP_DIR, old.name), { recursive: true, force: true })

  return { name: stamp, files: files.length, rows: files.reduce((sum, file) => sum + file.rows, 0), ledgerHead: head || null }
}

export function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return []
  return fs.readdirSync(BACKUP_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(BACKUP_DIR, entry.name, 'manifest.json')))
    .map((entry) => {
      const manifest = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, entry.name, 'manifest.json'), 'utf8'))
      return { name: entry.name, createdAt: manifest.createdAt, files: manifest.files.length, ledgerHead: manifest.ledgerHead }
    })
    .sort((a, b) => b.name.localeCompare(a.name))
}

// A daily export, plus one at start-up if the latest is old. Off when BACKUPS=off.
export function startBackups(common) {
  if (process.env.BACKUPS === 'off') return

  const run = async () => {
    try {
      const latest = listBackups()[0]
      if (!latest || Date.now() - new Date(latest.createdAt).getTime() > EVERY_HOURS * 3600 * 1000) {
        const made = await backupNow(common)
        console.log(`[backup] export ${made.name} (${made.files} tables, ${made.rows} rows)`)
      }
    } catch (error) {
      console.error(`[backup] failed: ${error.message}`)
    }
  }

  setTimeout(run, 8000).unref?.()
  setInterval(run, 3600 * 1000).unref?.()
}

// Checks the files of an export against its manifest.
export function verifyBackup(folder) {
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'))
  const bad = manifest.files.filter((item) => {
    const file = path.join(folder, item.path)
    return !fs.existsSync(file) || sha256(fs.readFileSync(file)) !== item.sha256
  })
  return { manifest, bad }
}

export { usingHostedDatabase }
