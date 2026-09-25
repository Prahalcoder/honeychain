// One command to run all of Honey Chain:   npm start   (from this folder)
//
//   db       Local PostgreSQL server          127.0.0.1:54329 (database honeychain); skipped when DATABASE_URL is set
//   chain    Local Ethereum chain + contract  http://127.0.0.1:8545 (RPC); skipped when CHAIN_RPC_URL is a public network
//   api      Node API, databases, chain link  http://localhost:5000
//   iot      Python hive monitor (ESP32)      http://localhost:5001
//   keeper   Honey Chain Keeper               http://localhost:5173
//   admin    Honey Chain Admin (KVIC portal)  http://localhost:5174
//   website  Public Honey Chain website       http://localhost:5175
//
// The Admin app has no server of its own: it uses the same API as Keeper.
// Missing node_modules are installed automatically on the first run.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { lanAddress } from './APICtech/backend/src/config/network.js'

const root = path.dirname(fileURLToPath(import.meta.url))
const isWindows = process.platform === 'win32'

// The API's own settings (APICtech/backend/.env) decide whether a local chain and database are needed.
const settings = {}
try {
  for (const line of fs.readFileSync(path.join(root, 'APICtech/backend/.env'), 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (match && !line.trim().startsWith('#')) settings[match[1]] = match[2].replace(/^["']|["']$/g, '')
  }
} catch { /* no .env yet */ }

const hostOf = (value) => { try { return new URL(value).host } catch { return value } }
const remoteDatabase = Boolean(settings.DATABASE_URL) && !/127\.0\.0\.1|localhost/.test(settings.DATABASE_URL)
const remoteChain = Boolean(settings.CHAIN_RPC_URL) && !/127\.0\.0\.1|localhost/.test(settings.CHAIN_RPC_URL)

const services = [
  ...(settings.DATABASE_URL ? [] : [{ name: 'db', color: 36, dir: 'APICtech/backend', command: 'node scripts/local-postgres.mjs', needsInstall: true }]),
  ...(remoteChain ? [] : [{ name: 'chain', color: 31, dir: 'blockchain', command: 'node scripts/serve.mjs', needsInstall: true }]),
  { name: 'api', color: 36, dir: 'APICtech/backend', command: 'node src/server.js', needsInstall: true },
  { name: 'iot', color: 33, dir: 'APICtech/beehive/python_app', command: isWindows ? 'python app.py' : 'python3 app.py' },
  { name: 'keeper', color: 32, dir: 'APICtech/frontend', command: 'npm run dev', needsInstall: true },
  { name: 'admin', color: 35, dir: 'apictech-admin', command: 'npm run dev', needsInstall: true },
  { name: 'website', color: 34, dir: 'honeychain-web', command: 'npm run dev', needsInstall: true },
]

const paint = (code, text) => `\x1b[${code}m${text}\x1b[0m`

console.log(paint(36, settings.DATABASE_URL
  ? `Database: ${remoteDatabase ? 'hosted' : 'your own'} Postgres (${hostOf(settings.DATABASE_URL)})`
  : 'Database: PostgreSQL running on this computer (127.0.0.1:54329, database honeychain, user postgres, password postgres).'))
console.log(paint(31, remoteChain
  ? `Blockchain: public network (${hostOf(settings.CHAIN_RPC_URL)})`
  : 'Blockchain: local chain on this computer (http://127.0.0.1:8545).'))

// First run: install dependencies for any app that has none yet.
for (const service of services) {
  const folder = path.join(root, service.dir)

  if (service.needsInstall && !fs.existsSync(path.join(folder, 'node_modules'))) {
    console.log(paint(service.color, `[${service.name}] installing dependencies (first run only)...`))
    const result = spawnSync('npm', ['install'], { cwd: folder, stdio: 'inherit', shell: true })
    if (result.status !== 0) {
      console.error(`Could not install dependencies for ${service.dir}.`)
      process.exit(1)
    }
  }
}

const children = []

function pipe(stream, service) {
  let buffer = ''

  stream.on('data', (chunk) => {
    buffer += chunk.toString()
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop()

    for (const line of lines) {
      if (line.trim()) console.log(`${paint(service.color, `[${service.name}]`.padEnd(10))} ${line}`)
    }
  })
}

for (const service of services) {
  const child = spawn(service.command, {
    cwd: path.join(root, service.dir),
    shell: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', FORCE_COLOR: '0' },
  })

  pipe(child.stdout, service)
  pipe(child.stderr, service)
  child.on('exit', (code) => {
    if (!stopping) console.log(paint(31, `[${service.name}] stopped (exit code ${code}). The others keep running; press Ctrl+C to stop everything.`))
  })
  children.push(child)
}

let stopping = false

function stopAll() {
  if (stopping) return
  stopping = true
  console.log('\nStopping Honey Chain...')

  // Stop the API and the apps first, then the database last and cleanly, so no write is cut in half.
  const database = services.findIndex((service) => service.name === 'db')
  for (const [index, child] of children.entries()) {
    if (index === database) continue
    if (!child.pid) continue
    if (isWindows) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else child.kill('SIGTERM')
  }

  if (database >= 0) {
    spawnSync('node', ['scripts/local-postgres.mjs', 'stop'], { cwd: path.join(root, 'APICtech/backend'), stdio: 'ignore', shell: true })
    const child = children[database]
    if (child?.pid) {
      if (isWindows) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      else child.kill('SIGTERM')
    }
  }

  setTimeout(() => process.exit(0), 600)
}

process.on('SIGINT', stopAll)
process.on('SIGTERM', stopAll)

setTimeout(() => {
  console.log(`
${paint(33, '  Honey Chain is starting. Open:')}
    Public website (verify honey)   http://localhost:5175
    Honey Chain Keeper              http://localhost:5173
    Honey Chain Admin (KVIC)        http://localhost:5174
    API health                      http://localhost:5000/api/health
    Database (pgAdmin, DBeaver...)  127.0.0.1:54329  db honeychain  user postgres  password postgres
    IoT hive monitor                http://localhost:5001
${lanAddress() ? `
${paint(33, '  On your phone (same Wi-Fi):')}
    Keeper                          http://${lanAddress()}:5173
    Admin                           http://${lanAddress()}:5174
    Public website                  http://${lanAddress()}:5175

${paint(33, '  Install Keeper/Admin as an app (phone home screen):')}
    Open the Keeper or Admin link above on the phone's browser, then use
    "Add to Home screen" / "Install app" from the browser menu (Chrome)
    or the Share sheet (iOS Safari). It launches full-screen, like a
    native app, against this same server. See README for the optional
    HTTPS mode that also adds offline caching and background updates.
` : ''}  Press Ctrl+C to stop everything.
`)
}, 6000)
