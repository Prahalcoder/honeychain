// A real PostgreSQL server that runs on this computer, for Honey Chain's data.
//
//   node scripts/local-postgres.mjs          start it (npm start at the repository root does this)
//   node scripts/local-postgres.mjs stop     stop it cleanly (fast shutdown, nothing is lost)
//
// The server binaries come from the "embedded-postgres" npm package, so there is nothing to install by
// hand. The data is kept in APICtech/backend/data/pgdata and survives restarts.
//
// Connect to it with any tool (pgAdmin, DBeaver, TablePlus, psql, VS Code):
//   host 127.0.0.1   port 54329   database honeychain   user postgres   password postgres
// It only listens on this computer (127.0.0.1).
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import EmbeddedPostgres from 'embedded-postgres'

const here = path.dirname(fileURLToPath(import.meta.url))
const backendRoot = path.resolve(here, '..')

export const LOCAL = {
  dir: path.resolve(process.env.LOCAL_PG_DIR || path.join(process.env.DATA_DIR || path.join(backendRoot, 'data'), 'pgdata')),
  port: Number(process.env.LOCAL_PG_PORT || 54329),
  user: 'postgres',
  password: 'postgres',
  database: 'honeychain',
}

const listening = () => new Promise((resolve) => {
  const socket = net.connect({ host: '127.0.0.1', port: LOCAL.port })
  socket.once('connect', () => { socket.destroy(); resolve(true) })
  socket.once('error', () => resolve(false))
})

// pg_ctl ships next to the server binary.
function pgCtl() {
  const platformPackage = `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
  return path.join(backendRoot, 'node_modules', '@embedded-postgres', platformPackage, 'native', 'bin', process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl')
}

if (process.argv[2] === 'stop') {
  if (fs.existsSync(path.join(LOCAL.dir, 'postmaster.pid'))) {
    spawnSync(pgCtl(), ['stop', '-D', LOCAL.dir, '-m', 'fast', '-w', '-t', '20'], { stdio: 'ignore' })
  }
  process.exit(0)
}

if (await listening()) {
  console.log(`Local Postgres is already running on 127.0.0.1:${LOCAL.port}.`)
  setInterval(() => {}, 1 << 30)
} else {
  const server = new EmbeddedPostgres({
    databaseDir: LOCAL.dir,
    user: LOCAL.user,
    password: LOCAL.password,
    port: LOCAL.port,
    persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {},
    onError: (message) => { if (/FATAL|PANIC/.test(String(message))) console.error(String(message).trim()) },
  })

  if (!fs.existsSync(path.join(LOCAL.dir, 'PG_VERSION'))) {
    console.log('Creating the local database (first run only)...')
    fs.mkdirSync(path.dirname(LOCAL.dir), { recursive: true })
    await server.initialise()
  }

  // A crash or a forced stop leaves this file behind; Postgres recovers from it on its own.
  await server.start()

  const admin = new pg.Client({ host: '127.0.0.1', port: LOCAL.port, user: LOCAL.user, password: LOCAL.password, database: 'postgres' })
  await admin.connect()
  const exists = (await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [LOCAL.database])).rowCount > 0
  if (!exists) await admin.query(`CREATE DATABASE ${LOCAL.database} ENCODING 'UTF8' TEMPLATE template0`)
  await admin.end()

  console.log(`Local Postgres ready: 127.0.0.1:${LOCAL.port}, database ${LOCAL.database}, user ${LOCAL.user}, password ${LOCAL.password}`)

  const shutdown = async () => {
    try { await server.stop() } catch { /* already stopped */ }
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  setInterval(() => {}, 1 << 30)
}
