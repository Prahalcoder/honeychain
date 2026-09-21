import fs from 'node:fs'
import path from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import pg from 'pg'
import { PGlite, types as pgliteTypes } from '@electric-sql/pglite'

import { DATA_DIR } from '../config/paths.js'

// One Postgres connection layer for the whole backend.
//
//   DATABASE_URL empty  -> the Postgres server that runs on this computer (scripts/local-postgres.mjs,
//                          started by `npm start`): 127.0.0.1:54329, database honeychain. Nothing is external.
//   DATABASE_URL set    -> any other Postgres (a hosted one such as Supabase, or one you installed yourself).
//   DATABASE=embedded   -> an in-process Postgres (PGlite), used by the automated tests.
//
// The rest of the code keeps the small "prepare(sql).get / all / run" shape it always had, but every
// call is now asynchronous (await it). Statements written with `?` placeholders are translated here.
// A transaction is a function: `await db.transaction(async () => { ... })()`; every statement issued
// inside it, on any handle, runs on the same connection and commits or rolls back together.
const embedded = process.env.DATABASE === 'embedded' || process.env.PGLITE_MEMORY === '1' || Boolean(process.env.PGLITE_DIR)
const LOCAL_URL = `postgresql://postgres:postgres@127.0.0.1:${process.env.LOCAL_PG_PORT || 54329}/honeychain`
export const DATABASE_URL = process.env.DATABASE_URL || (embedded ? '' : LOCAL_URL)
export const usingHostedDatabase = Boolean(DATABASE_URL)
const isLocalServer = /localhost|127\.0\.0\.1/.test(DATABASE_URL)

const asNumber = (value) => (value === null ? null : Number(value))
pg.types.setTypeParser(20, asNumber)      // bigint (COUNT, SUM of integers)
pg.types.setTypeParser(1700, asNumber)    // numeric (AVG, SUM of decimals)

// ------------------------------------------------------------------ drivers
function hostedDriver() {
  const local = isLocalServer
  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    max: Number(process.env.DB_POOL_SIZE || 10),
    ssl: local || /sslmode=disable/.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
  })
  pool.on('error', (error) => console.error(`[db] idle connection error: ${error.message}`))

  return {
    kind: local ? 'postgres (local server)' : 'postgres (hosted)',
    query: (sql, params, tx) => (tx || pool).query(sql, params).then((result) => ({ rows: result.rows, count: result.rowCount })),
    exec: (sql, tx) => (tx || pool).query(sql).then(() => undefined),
    async transaction(work) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await work(client)
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        throw error
      } finally {
        client.release()
      }
    },
    close: () => pool.end(),
  }
}

function embeddedDriver() {
  const dir = process.env.PGLITE_DIR ? path.resolve(process.env.PGLITE_DIR) : path.join(DATA_DIR, 'postgres')
  if (process.env.PGLITE_MEMORY !== '1') fs.mkdirSync(dir, { recursive: true })
  const lite = new PGlite(process.env.PGLITE_MEMORY === '1' ? undefined : dir, {
    parsers: { [pgliteTypes.INT8]: asNumber, [pgliteTypes.NUMERIC]: asNumber },
  })

  return {
    kind: 'postgres (embedded PGlite)',
    query: async (sql, params, tx) => {
      const result = await (tx || lite).query(sql, params)
      return { rows: result.rows, count: result.affectedRows ?? result.rows.length }
    },
    exec: async (sql, tx) => { await (tx || lite).exec(sql) },
    transaction: (work) => lite.transaction((tx) => work(tx)),
    close: () => lite.close(),
  }
}

export const driver = usingHostedDatabase ? hostedDriver() : embeddedDriver()

// The local server may still be starting when the API starts (npm start launches both together).
if (usingHostedDatabase) {
  let lastError = null
  for (let attempt = 0; attempt < 90; attempt++) {
    try { await driver.query('SELECT 1', []); lastError = null; break } catch (error) {
      lastError = error
      if (attempt === 2) console.log(isLocalServer ? '[db] waiting for the local Postgres server...' : '[db] waiting for the database...')
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
  if (lastError) {
    console.error(isLocalServer
      ? `The local Postgres server is not running (${lastError.message}). Start everything with "npm start" in the repository root, or start only the database with "npm run db:local" in APICtech/backend.`
      : `Cannot reach the database in DATABASE_URL: ${lastError.message}`)
    process.exit(1)
  }
}

// ------------------------------------------------------------------ SQL translation
// The code base was written against SQLite. These rewrites cover every construct it uses.
function placeholders(sql) {
  let out = ''
  let n = 0
  let quote = false
  for (const char of sql) {
    if (char === "'") quote = !quote
    if (char === '?' && !quote) { n += 1; out += `$${n}` } else out += char
  }
  return out
}

function translate(sql, handle) {
  let text = sql.trim().replace(/;$/, '')
  const ignore = /^INSERT\s+OR\s+IGNORE\s+INTO/i.test(text)
  if (ignore) text = text.replace(/^INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO')

  text = placeholders(text)
    .replace(/\bCURRENT_TIMESTAMP\b/g, "to_char(timezone('UTC', now()), 'YYYY-MM-DD HH24:MI:SS')")   // text timestamps, as before
    .replace(/\bLIKE\b/g, 'ILIKE')                                   // SQLite's LIKE ignores case
    .replace(/\bAS\s+([a-z][a-z0-9_]*[A-Z][A-Za-z0-9_]*)\b/g, 'AS "$1"')   // keep camelCase aliases

  if (ignore) text += ' ON CONFLICT DO NOTHING'

  if (handle.schema) {
    const names = handle.tables.join('|')
    text = text.replace(new RegExp(`\\b(FROM|JOIN|INTO|UPDATE)\\s+(${names})\\b`, 'gi'), (_, keyword, table) => `${keyword} "${handle.schema}".${table}`)
  }

  const insert = /^INSERT\s+INTO\s+"?(?:\w+"?\.)?"?(\w+)"?/i.exec(text)
  const wantsId = insert && !/\bRETURNING\b/i.test(text) && handle.identityTables.has(insert[1].toLowerCase())
  if (wantsId) text += ' RETURNING id'

  return text
}

// Like SQLite: undefined and NaN become NULL, true/false become 1/0.
const clean = (params) => params.flat().map((value) => (value === undefined || (typeof value === 'number' && Number.isNaN(value)) ? null : typeof value === 'boolean' ? Number(value) : value))

// ------------------------------------------------------------------ handles and statements
const scope = new AsyncLocalStorage()
let savepoints = 0

class Statement {
  constructor(handle, sql) {
    this.handle = handle
    this.sql = sql
  }

  async execute(params) {
    await this.handle.ready
    const text = this.handle.translated(this.sql)
    return driver.query(text, clean(params), scope.getStore()?.tx)
  }

  async get(...params) { return (await this.execute(params)).rows[0] }
  async all(...params) { return (await this.execute(params)).rows }
  async run(...params) {
    const result = await this.execute(params)
    return { changes: result.count, lastInsertRowid: result.rows[0]?.id }
  }
}

class Handle {
  // schema === null is the common database (the default schema); otherwise a company's private schema.
  constructor({ schema = null, tables = [] } = {}) {
    this.schema = schema
    this.tables = tables
    this.identityTables = new Set()
    this.cache = new Map()
    this.ready = this.loadIdentityTables()
  }

  async loadIdentityTables() {
    const rows = (await sqlQuery(
      `SELECT table_name FROM information_schema.columns
       WHERE table_schema = ${this.schema ? '$1' : 'current_schema()'} AND column_name = 'id' AND is_identity = 'YES'`,
      this.schema ? [this.schema] : [],
    )).rows
    this.identityTables = new Set(rows.map((row) => row.table_name))
  }

  // Call after creating tables so INSERT ... RETURNING id is added for the new ones.
  refresh() {
    this.cache.clear()
    this.ready = this.loadIdentityTables()
    return this.ready
  }

  translated(sql) {
    let text = this.cache.get(sql)
    if (!text) { text = translate(sql, this); this.cache.set(sql, text) }
    return text
  }

  prepare(sql) { return new Statement(this, sql) }

  // Several statements without parameters (schema changes).
  async exec(sql) { await driver.exec(sql, scope.getStore()?.tx) }

  // Returns a function; calling it runs the work in a transaction (nested calls use a savepoint).
  transaction(work) {
    return (...args) => {
      const outer = scope.getStore()
      if (outer) return runNested(outer, work, args)
      return driver.transaction((tx) => scope.run({ tx }, () => work(...args)))
    }
  }
}

async function runNested(outer, work, args) {
  const name = `sp_${++savepoints}`
  await driver.exec(`SAVEPOINT ${name}`, outer.tx)
  try {
    const result = await work(...args)
    await driver.exec(`RELEASE SAVEPOINT ${name}`, outer.tx)
    return result
  } catch (error) {
    await driver.exec(`ROLLBACK TO SAVEPOINT ${name}`, outer.tx)
    throw error
  }
}

export function createHandle(options) {
  return new Handle(options)
}

// A schema change that must see its own tables: runs in one transaction with the schema selected.
export async function inSchema(schema, sql) {
  const script = `CREATE SCHEMA IF NOT EXISTS "${schema}"; SET LOCAL search_path TO "${schema}", public;
${sql}
RESET search_path;`
  const outer = scope.getStore()
  if (outer) await driver.exec(script, outer.tx)
  else await driver.transaction((tx) => driver.exec(script, tx))
}

// Plain statements that join the current transaction when there is one (never wait on it).
export const sqlQuery = (sql, params = []) => driver.query(sql, params, scope.getStore()?.tx)
export const sqlExec = (sql) => driver.exec(sql, scope.getStore()?.tx)

export const closeDatabase = () => driver.close()
