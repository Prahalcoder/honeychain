import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Contract, JsonRpcProvider, NonceManager, Wallet, keccak256, toUtf8Bytes } from 'ethers'

import db from '../database/database.js'
import { lockDown, pgDdl } from '../database/ddl.js'
import { DATA_DIR } from '../config/paths.js'
import { TYPES, buildMerkle, domainFor, idOf, leafOf } from './chainCodec.js'
import { pinJson } from './ipfs.js'

// The bridge between the Honey Chain backend and the HoneyChain smart contract
// (blockchain/contracts/HoneyChain.sol).
//
//  - Every on-chain action is first written to an OUTBOX table (chain_outbox) as an intent.
//    The app never waits for, or breaks because of, the chain.
//  - A worker sends the intents in order, signing each with the right wallet (EIP-712):
//    keeper wallet for batches, jars and sales, officer wallet for certification, and the
//    relayer (the server's own account) only pays gas and anchors the audit-ledger head.
//  - If the local development chain is restarted (it keeps nothing in memory) the worker notices
//    the block number went backwards and replays everything from the database.
//
// Wallets are custodial: keys are generated per user and encrypted with WALLET_MASTER_KEY
// (or data/wallet-master.key). See docs in README for moving to user-held keys.
const here = path.dirname(fileURLToPath(import.meta.url))
const BLOCKCHAIN_DIR = process.env.HONEYCHAIN_BLOCKCHAIN_DIR || path.resolve(here, '../../../../blockchain')
const RPC_URL = process.env.CHAIN_RPC_URL || 'http://127.0.0.1:8545'
const ENABLED = process.env.CHAIN_ENABLED !== 'false'
const DEV_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const MAX_ATTEMPTS = 10
// A local development chain is free and fast; a public testnet costs gas and takes a few seconds per block.
const LOCAL_CHAIN = /127\.0\.0\.1|localhost/.test(RPC_URL)
const ANCHOR_EVERY_MS = Number(process.env.CHAIN_ANCHOR_EVERY_SECONDS || (LOCAL_CHAIN ? 20 : 600)) * 1000
const TIMEOUT_MS = Number(process.env.CHAIN_TIMEOUT_MS || (LOCAL_CHAIN ? 4000 : 20000))
const EXPLORERS = { 80002: 'https://amoy.polygonscan.com', 137: 'https://polygonscan.com', 11155111: 'https://sepolia.etherscan.io' }
const explorerFor = (chainId) => (process.env.CHAIN_EXPLORER_URL || EXPLORERS[chainId] || '').replace(/\/$/, '') || null

await db.exec(pgDdl(`
  CREATE TABLE IF NOT EXISTS chain_wallets (
    user_id INTEGER PRIMARY KEY,
    address TEXT NOT NULL,
    secret TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chain_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    ref TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    tx_hash TEXT,
    block_number INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (kind, ref)
  );

  CREATE TABLE IF NOT EXISTS chain_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`))
await db.refresh()
await lockDown('public')

const meta = async (key, fallback = null) => (await db.prepare('SELECT value FROM chain_meta WHERE key = ?').get(key))?.value ?? fallback
const setMeta = async (key, value) => await db.prepare('INSERT INTO chain_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value))
const now = () => new Date().toISOString()

const live = { provider: null, relayer: null, contract: null, chainId: null, address: null, artifact: null, error: '', announced: '', timer: null, busy: false }

function announce(message) {
  if (live.announced === message) return
  live.announced = message
  console.log(`[chain] ${message}`)
}

// ---------------------------------------------------------------- wallets
function masterKey() {
  if (process.env.WALLET_MASTER_KEY) return Buffer.from(process.env.WALLET_MASTER_KEY.replace(/^0x/, ''), 'hex')

  const file = path.join(DATA_DIR, 'wallet-master.key')
  if (!fs.existsSync(file)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 })
  }
  return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex')
}

function seal(text) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv)
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') })
}

function unseal(secret) {
  const { iv, tag, data } = JSON.parse(secret)
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')
}

// Every user gets an Ethereum account of their own the first time it is needed.
export async function walletFor(userId) {
  const row = await db.prepare('SELECT * FROM chain_wallets WHERE user_id = ?').get(userId)
  if (row) return new Wallet(unseal(row.secret))

  const wallet = Wallet.createRandom()
  await db.prepare('INSERT INTO chain_wallets (user_id, address, secret, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id) DO NOTHING').run(userId, wallet.address, seal(wallet.privateKey), now())
  // Two requests may race to create the first wallet; whichever was stored first wins.
  return new Wallet(unseal((await db.prepare('SELECT secret FROM chain_wallets WHERE user_id = ?').get(userId)).secret))
}

export const addressOf = async (userId) => (await walletFor(userId)).address

// ---------------------------------------------------------------- outbox
async function enqueue(kind, ref, payload) {
  const result = await db.prepare('INSERT OR IGNORE INTO chain_outbox (kind, ref, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(kind, String(ref), JSON.stringify(payload), now(), now())
  return result.changes > 0
}

const safe = (label, fn) => Promise.resolve().then(fn).catch((error) => console.error(`[chain] ${label}: ${error.message}`))

async function ensureRole(role, userId) {
  const address = await addressOf(userId)
  await enqueue('SET_ROLE', `${role}:${address}`, { role, address })
  return address
}

const ledgerEventHash = async (batchCode, eventType) => (await db.prepare("SELECT current_hash FROM traceability_events WHERE entity_type = 'BATCH' AND entity_id = ? AND event_type = ? ORDER BY id LIMIT 1").get(batchCode, eventType))?.current_hash
const unix = (date) => Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000)
const hex = (value) => (String(value).startsWith('0x') ? value : `0x${value}`)

// ---------------------------------------------------------------- hooks (called by the routes)
// A batch must exist on chain before anything else can refer to it. This registers it (once) with
// the keeper's signature, also for batches harvested before the chain link existed.
async function ensureBatch(batchCode) {
  const batch = await db.prepare('SELECT b.*, o.owner_user_id FROM batches b JOIN organizations o ON o.id = b.org_id WHERE b.batch_code = ?').get(batchCode)
  if (!batch) return null

  await ensureRole('harvester', batch.owner_user_id)
  await enqueue('REGISTER_BATCH', batch.batch_code, {
    signerUserId: batch.owner_user_id, batchCode: batch.batch_code, quantityGrams: Math.round(batch.quantity_kg * 1000), harvestedAt: unix(batch.harvest_date),
    ledgerEventHash: hex(await ledgerEventHash(batch.batch_code, 'HARVEST_RECORDED') || '0'.repeat(64)),
  })
  return batch
}

export function onHarvest({ batchCode }) {
  return safe('harvest', async () => await ensureBatch(batchCode))
}

// The officer verified a lab certificate: publish the public metadata and enqueue the second signature.
export function onLabVerified({ review, officer, passed }) {
  return safe('certify', async () => await certify({ review, officer, passed }))
}

// A batch whose lab result was verified before the chain link existed (or while it was off) has no
// certification queued. Build it from the stored, verified review, signed by the officer who verified it.
async function ensureCertified(batchCode) {
  if (await db.prepare("SELECT 1 FROM chain_outbox WHERE kind = 'CERTIFY_BATCH' AND ref = ?").get(batchCode)) return

  const row = await db.prepare(`
    SELECT r.reviewed_by, r.document_sha256, t.lab_name, t.certificate_reference, t.results_json, t.tested_at, t.status AS declared_status
    FROM lab_reviews r
    JOIN laboratory_tests t ON t.id = r.lab_test_id
    JOIN batches b ON b.id = r.batch_id
    WHERE b.batch_code = ? AND r.status = 'VERIFIED'
    ORDER BY r.id DESC LIMIT 1
  `).get(batchCode)
  if (!row) return

  const officer = await db.prepare('SELECT id, name, role, state, region FROM users WHERE id = ?').get(row.reviewed_by)
  if (!officer) return

  let results = null
  try { results = row.results_json ? JSON.parse(row.results_json) : null } catch { /* keep null */ }
  await certify({
    review: { batchCode, documentSha256: row.document_sha256, certificateReference: row.certificate_reference, labName: row.lab_name, results, testedAt: row.tested_at, declaredStatus: row.declared_status },
    officer,
    passed: row.declared_status === 'PASSED',
  })
}

async function certify({ review, officer, passed }) {
  {
    const batch = await db.prepare('SELECT b.*, o.legal_name, o.fssai_license, o.state, o.region, o.owner_user_id FROM batches b JOIN organizations o ON o.id = b.org_id WHERE b.batch_code = ?').get(review.batchCode)
    if (!batch) return

    await ensureBatch(batch.batch_code)

    const labReportHash = hex(review.documentSha256 || crypto.createHash('sha256').update(JSON.stringify({ certificate: review.certificateReference, lab: review.labName, results: review.results })).digest('hex'))
    const pinned = await pinJson({
      schema: 'honeychain.batch.v1',
      batchCode: batch.batch_code,
      honeyType: batch.honey_type,
      harvestDate: batch.harvest_date,
      quantityKg: batch.quantity_kg,
      origin: { state: batch.state, region: batch.region },
      producer: { name: batch.legal_name, fssaiLicense: batch.fssai_license },
      laboratory: { name: review.labName, certificate: review.certificateReference, testedAt: review.testedAt, declaredStatus: review.declaredStatus, results: review.results, reportSha256: labReportHash },
      verifiedBy: { name: officer.name, role: officer.role, state: officer.state, region: officer.region },
      ledgerEventHash: await ledgerEventHash(batch.batch_code, 'HARVEST_RECORDED') || null,
      verifiedAt: now(),
    })

    await ensureRole('officer', officer.id)
    await enqueue('CERTIFY_BATCH', batch.batch_code, { signerUserId: officer.id, batchCode: batch.batch_code, labReportHash, metadataCid: pinned.cid, passed })
  }
}

export function onJarsCreated({ userId, packBatchCode, batchCode }) {
  return safe('jars', async () => { await ensureBatch(batchCode); await ensureCertified(batchCode); await enqueue('REGISTER_JARS', packBatchCode, { signerUserId: userId, packBatchCode, batchCode }) })
}

export function onLooseSale({ userId, organizationCode, saleCode, batchCode, grams, buyerLabel }) {
  return safe('loose sale', async () => await ensureBatch(batchCode) && await enqueue('LOOSE_SALE', `${organizationCode}:${saleCode}`, { signerUserId: userId, saleKey: `${organizationCode}:${saleCode}`, batchCode, grams, buyerLabel }))
}

export function onLooseSaleReversed({ userId, organizationCode, saleCode, batchCode }) {
  return safe('loose sale reversal', async () => await enqueue('LOOSE_REVERSE', `${organizationCode}:${saleCode}`, { signerUserId: userId, saleKey: `${organizationCode}:${saleCode}`, batchCode }))
}

// ---------------------------------------------------------------- connection
function loadArtifact() {
  const file = path.join(BLOCKCHAIN_DIR, 'artifacts', 'HoneyChain.json')
  if (!fs.existsSync(file)) throw new Error(`contract artifact not found (${file}). Run "npm run compile" in the blockchain folder`)
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

async function connect() {
  live.artifact = live.artifact || loadArtifact()
  live.provider?.destroy?.()
  live.provider = new JsonRpcProvider(RPC_URL, undefined, { staticNetwork: false })
  live.chainId = Number((await live.provider.getNetwork()).chainId)

  const key = process.env.CHAIN_PRIVATE_KEY || (live.chainId === 31337 ? DEV_KEY : null)
  if (!key) throw new Error('CHAIN_PRIVATE_KEY is required on a public network')

  const deployment = path.join(BLOCKCHAIN_DIR, 'deployments', `${live.chainId}.json`)
  live.address = process.env.HONEYCHAIN_CONTRACT || (fs.existsSync(deployment) ? JSON.parse(fs.readFileSync(deployment, 'utf8')).address : null)
  if (!live.address) throw new Error('the contract is not deployed yet. Run "npm run node" (local) or "npm run deploy" in the blockchain folder')

  live.relayer = new NonceManager(new Wallet(key, live.provider))
  live.contract = new Contract(live.address, live.artifact.abi, live.relayer)
}

const withTimeout = (promise, ms = TIMEOUT_MS) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('the chain did not answer in time')), ms))])

// ---------------------------------------------------------------- worker
const failure = (error) => String(error.reason || error.info?.error?.message || error.error?.message || error.shortMessage || error.message || error).slice(0, 240)

async function send(item) {
  const p = JSON.parse(item.payload_json)
  const domain = domainFor(live.chainId, live.address)
  const sign = async (userId, name, value) => (await walletFor(userId)).signTypedData(domain, { [name]: TYPES[name] }, value)

  switch (item.kind) {
    case 'SET_ROLE':
      return p.role === 'officer' ? live.contract.setOfficer(p.address, true) : live.contract.setHarvester(p.address, true)

    case 'REGISTER_BATCH': {
      const value = { batchId: idOf(p.batchCode), harvester: await addressOf(p.signerUserId), quantityGrams: p.quantityGrams, harvestedAt: p.harvestedAt, ledgerEventHash: p.ledgerEventHash }
      return live.contract.registerBatch(value.batchId, value.quantityGrams, value.harvestedAt, value.ledgerEventHash, value.harvester, await sign(p.signerUserId, 'RegisterBatch', value))
    }

    case 'CERTIFY_BATCH': {
      const value = { batchId: idOf(p.batchCode), officer: await addressOf(p.signerUserId), labReportHash: p.labReportHash, metadataCid: p.metadataCid, passed: p.passed }
      return live.contract.certifyBatch(value.batchId, value.labReportHash, value.metadataCid, value.passed, value.officer, await sign(p.signerUserId, 'CertifyBatch', value))
    }

    case 'REGISTER_JARS': {
      await ensureCertified(p.batchCode)   // jars need a certified batch; queue the certification if it was missed
      const lot = await db.prepare('SELECT * FROM pack_batches WHERE pack_batch_code = ?').get(p.packBatchCode)
      const ids = (await db.prepare('SELECT pack_id FROM packs WHERE pack_batch_id = ? ORDER BY id').all(lot.id)).map((row) => row.pack_id)
      const value = { lotId: idOf(p.packBatchCode), batchId: idOf(p.batchCode), merkleRoot: buildMerkle(ids.map(leafOf)).root, count: ids.length, jarGrams: lot.jar_size_grams }
      return live.contract.registerJars(value.lotId, value.batchId, value.merkleRoot, value.count, value.jarGrams, await sign(p.signerUserId, 'RegisterJars', value))
    }

    case 'LOOSE_SALE': {
      const value = { saleId: idOf(p.saleKey), batchId: idOf(p.batchCode), grams: p.grams, buyerHash: keccak256(toUtf8Bytes(p.buyerLabel)) }
      return live.contract.recordLooseSale(value.saleId, value.batchId, value.grams, value.buyerHash, await sign(p.signerUserId, 'LooseSale', value))
    }

    case 'LOOSE_REVERSE': {
      const value = { saleId: idOf(p.saleKey), batchId: idOf(p.batchCode) }
      return live.contract.reverseLooseSale(value.saleId, await sign(p.signerUserId, 'ReverseLooseSale', value))
    }

    case 'ANCHOR':
      return live.contract.anchorLedger(p.height, hex(p.head))

    default:
      throw new Error(`unknown outbox kind ${item.kind}`)
  }
}

async function queueAnchor() {
  const head = await db.prepare('SELECT height, block_hash FROM chain_blocks ORDER BY height DESC LIMIT 1').get()
  if (!head) return
  if (head.height <= Number(await meta('anchoredHeight', -1))) return
  if (await db.prepare("SELECT 1 FROM chain_outbox WHERE kind = 'ANCHOR' AND status = 'PENDING'").get()) return
  if (Date.now() - Number(await meta('anchorQueuedAt', 0)) < ANCHOR_EVERY_MS) return

  await setMeta('anchorQueuedAt', Date.now())
  await enqueue('ANCHOR', String(head.height), { height: head.height, head: head.block_hash })
}

async function tick() {
  if (live.busy) return
  live.busy = true

  try {
    if (!live.contract) await connect()

    const block = await withTimeout(live.provider.getBlockNumber())
    if ((await withTimeout(live.provider.getCode(live.address))) === '0x') {
      announce('the chain is running but the contract is missing. Run "npm run node" in the blockchain folder')
      return
    }

    // A development chain that was restarted has forgotten everything: replay from the database.
    if (LOCAL_CHAIN && block < Number(await meta('maxBlock', 0))) {
      const replay = (await db.prepare("UPDATE chain_outbox SET status = 'PENDING', tx_hash = NULL, block_number = NULL, attempts = 0, last_error = NULL WHERE status IN ('CONFIRMED', 'FAILED')").run()).changes
      await setMeta('maxBlock', 0)
      await setMeta('anchoredHeight', -1)
      await setMeta('resets', Number(await meta('resets', 0)) + 1)
      live.contract = null
      announce(`the chain was reset, replaying ${replay} record(s) from the database`)
      return
    }

    live.error = ''
    announce(`connected to chain ${live.chainId}, contract ${live.address}, block ${block}`)
    await queueAnchor()

    const pending = await db.prepare("SELECT * FROM chain_outbox WHERE status = 'PENDING' ORDER BY id LIMIT 25").all()
    for (const item of pending) {
      try {
        const tx = await send(item)
        const receipt = await tx.wait(1, TIMEOUT_MS * 6)
        await db.prepare("UPDATE chain_outbox SET status = 'CONFIRMED', tx_hash = ?, block_number = ?, last_error = NULL, updated_at = ? WHERE id = ?").run(receipt.hash, receipt.blockNumber, now(), item.id)
        await setMeta('maxBlock', Math.max(Number(await meta('maxBlock', 0)), receipt.blockNumber))
        if (item.kind === 'ANCHOR') await setMeta('anchoredHeight', JSON.parse(item.payload_json).height)
      } catch (error) {
        const reason = failure(error)
        const already = /exists|already/i.test(reason)

        // A failed transaction still used up a nonce inside the local nonce counter: ask the chain again.
        live.relayer?.reset?.()

        // Waiting for something queued earlier (a role, a registration, a certification): not a failure.
        if (/not certified|not a registered|not a certified officer|not registered|unknown batch/i.test(reason)) {
          await db.prepare('UPDATE chain_outbox SET last_error = ?, updated_at = ? WHERE id = ?').run(`waiting: ${reason}`, now(), item.id)
          continue
        }

        // No gas, or a busy network: wait and try again later instead of giving up on the record.
        if (/insufficient funds|underpriced|replacement|too many requests|rate limit/i.test(reason)) {
          await db.prepare('UPDATE chain_outbox SET last_error = ?, updated_at = ? WHERE id = ?').run(reason, now(), item.id)
          announce(`waiting: ${reason}${/insufficient/i.test(reason) ? ' (fund the relayer account from a faucet)' : ''}`)
          live.contract = null
          break
        }

        const attempts = item.attempts + 1
        const status = already ? 'CONFIRMED' : attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING'
        await db.prepare('UPDATE chain_outbox SET status = ?, attempts = ?, last_error = ?, updated_at = ? WHERE id = ?').run(status, attempts, already ? 'already on the chain' : reason, now(), item.id)
        if (already && item.kind === 'ANCHOR') await setMeta('anchoredHeight', JSON.parse(item.payload_json).height)
        if (!already) console.error(`[chain] ${item.kind} ${item.ref}: ${reason}`)
        // The link to the chain itself is broken: reconnect on the next round instead of failing the rest of this one.
        if (status === 'PENDING' && /nonce|network|connect|ECONN|timeout/i.test(reason)) { live.contract = null; break }
      }
    }
  } catch (error) {
    live.error = failure(error)
    live.contract = null
    announce(`waiting for the chain: ${live.error}`)
  } finally {
    live.busy = false
  }
}

export async function startChain() {
  if (!ENABLED) {
    announce('disabled (CHAIN_ENABLED=false)')
    return
  }
  if (live.timer) return

  // Items that gave up earlier get a fresh start now (the cause may have been fixed since).
  await db.prepare("UPDATE chain_outbox SET status = 'PENDING', attempts = 0 WHERE status = 'FAILED'").run()
  live.timer = setInterval(async () => { await tick() }, 3000)
  live.timer.unref?.()
  await tick()
}

// ---------------------------------------------------------------- reads for the API
export async function chainStatus() {
  const counts = Object.fromEntries((await db.prepare('SELECT status, COUNT(*) AS n FROM chain_outbox GROUP BY status').all()).map((row) => [row.status, row.n]))
  const anchor = await db.prepare("SELECT tx_hash, block_number, payload_json, updated_at FROM chain_outbox WHERE kind = 'ANCHOR' AND status = 'CONFIRMED' ORDER BY id DESC LIMIT 1").get()

  const status = {
    enabled: ENABLED,
    rpcUrl: (() => { try { return new URL(RPC_URL).origin } catch { return null } })(),   // never the path: it may hold an API key
    explorer: explorerFor(live.chainId),
    connected: false,
    chainId: live.chainId,
    contract: live.address,
    blockNumber: null,
    relayer: live.relayer ? await live.relayer.getAddress().catch(() => null) : null,
    outbox: { PENDING: 0, CONFIRMED: 0, FAILED: 0, ...counts },
    resets: Number(await meta('resets', 0)),
    lastAnchor: anchor ? { ...JSON.parse(anchor.payload_json), tx: anchor.tx_hash, block: anchor.block_number, at: anchor.updated_at } : null,
    error: live.error,
  }

  if (ENABLED && live.provider && live.contract) {
    try {
      status.blockNumber = await withTimeout(live.provider.getBlockNumber())
      status.connected = true
      const [height, head] = await withTimeout(Promise.all([live.contract.anchoredHeight(), live.contract.anchoredHead()]))
      status.onChainAnchor = { height: Number(height), head }
    } catch (error) {
      status.error = failure(error)
    }
  }
  return status
}

export async function recentOutbox(limit = 50) {
  return await db.prepare('SELECT id, kind, ref, status, tx_hash, block_number, attempts, last_error, created_at, updated_at FROM chain_outbox ORDER BY id DESC LIMIT ?').all(limit)
}

const txOf = async (kind, ref) => await db.prepare('SELECT status, tx_hash, block_number FROM chain_outbox WHERE kind = ? AND ref = ?').get(kind, ref) || null

// What the public verification page shows: database facts, checked live against the contract when it answers.
export async function proofFor({ batchCode, packBatchCode = null, packId = null }) {
  const proof = {
    enabled: ENABLED,
    chainId: live.chainId,
    explorer: explorerFor(live.chainId),
    contract: live.address,
    batch: { registered: await txOf('REGISTER_BATCH', batchCode), certified: await txOf('CERTIFY_BATCH', batchCode) },
    jars: packBatchCode ? await txOf('REGISTER_JARS', packBatchCode) : null,
    anchor: null,
    live: null,
  }

  const anchor = await db.prepare("SELECT tx_hash, block_number, payload_json FROM chain_outbox WHERE kind = 'ANCHOR' AND status = 'CONFIRMED' ORDER BY id DESC LIMIT 1").get()
  if (anchor) proof.anchor = { ...JSON.parse(anchor.payload_json), tx: anchor.tx_hash, block: anchor.block_number }

  const certify = await db.prepare("SELECT payload_json FROM chain_outbox WHERE kind = 'CERTIFY_BATCH' AND ref = ?").get(batchCode)
  if (certify) proof.metadataCid = JSON.parse(certify.payload_json).metadataCid

  if (!ENABLED || !live.contract) return proof

  try {
    const id = idOf(batchCode)
    const chain = await withTimeout(live.contract.getBatch(id))
    proof.live = { registered: Number(chain.registeredAt) > 0, certified: chain.certified, passed: chain.passed, quantityGrams: Number(chain.quantityGrams), jarGrams: Number(chain.jarGrams), looseGrams: Number(chain.looseGrams), officer: chain.officer, metadataCid: chain.metadataCid || null, labReportHash: chain.labReportHash }

    if (packBatchCode && packId) {
      const ids = (await db.prepare('SELECT pack_id FROM packs p JOIN pack_batches pb ON pb.id = p.pack_batch_id WHERE pb.pack_batch_code = ? ORDER BY p.id').all(packBatchCode)).map((row) => row.pack_id)
      const tree = buildMerkle(ids.map(leafOf))
      proof.live.jarProven = await withTimeout(live.contract.verifyJar(id, leafOf(packId), tree.proofFor(leafOf(packId)) || []))
    }
  } catch (error) {
    proof.live = { error: failure(error) }
  }
  return proof
}
