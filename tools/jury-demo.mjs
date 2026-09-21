// Builds a SEPARATE demo dataset for the hackathon jury and opens the data explorer on it.
// It starts its own copy of the backend on port 5058 with its own database files in
// tools/.demo/, so your real data in APICtech/backend is never touched.
//
//   npm run jury:demo
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const backend = path.join(root, 'APICtech', 'backend')
const demoDir = path.join(here, '.demo')
const PORT = 5058
const BASE = `http://localhost:${PORT}/api`
const Database = createRequire(path.join(backend, 'package.json'))('better-sqlite3')

fs.rmSync(demoDir, { recursive: true, force: true })
fs.mkdirSync(demoDir, { recursive: true })
process.env.DATABASE_FILE = path.join(demoDir, 'demo.db')
process.env.DATA_DIR = path.join(demoDir, 'data')

const server = spawn(process.execPath, ['src/server.js'], { cwd: backend, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' })
const stop = () => { try { server.kill() } catch { /* already stopped */ } }
process.on('exit', stop)

const day = (offset) => new Date(Date.now() + offset * 86400000).toLocaleDateString('en-CA')
async function call(method, route, { token, body } = {}) {
  const response = await fetch(`${BASE}${route}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${method} ${route}: ${response.status} ${json.message || ''}`)
  return json
}
const login = async (username, password) => (await call('POST', '/auth/login', { body: { username, password } })).token

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) return } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('The demo backend did not start')
}

let serial = 0
async function keeper(name, state, region, gstin = '') {
  serial += 1
  const registration = {
    name: `${name} Owner`, username: `demo.${name.toLowerCase().replace(/\W+/g, '')}`, password: 'demo@12345', organizationName: name,
    organizationType: 'KVIC_BEEKEEPER', registrationId: `MK-DEMO-${1000 + serial}`, fssaiLicense: String(10020042000100 + serial * 13),
    gstin, state, region, email: 'owner@example.com', phone: '9000000000',
  }
  const { token, user } = await call('POST', '/auth/register', { body: registration })
  return { name, token, orgId: user.organization.id, username: registration.username }
}

async function verifiedBatch(k, officer, hives, kg, jars) {
  const hive = await call('POST', '/company/hives', { token: k.token, body: {} })
  const harvest = await call('POST', '/company/harvests', { token: k.token, body: { hiveCode: hive.hive_code, harvestDate: day(-10), quantityKg: kg, honeyType: 'Wildflower Honey' } })
  const request = await call('POST', '/company/lab-requests', { token: k.token, body: { batchCode: harvest.batch_code, labName: 'NABL Accredited Honey Lab' } })
  const result = await call('POST', `/company/lab-requests/${request.requestId}/result`, { token: k.token, body: { certificateReference: `CERT-${harvest.batch_code}`, status: 'PASSED', testedAt: day(-6), results: { moisturePercent: 17.2, hmfMgPerKg: 14, sucrosePercent: 2.1, antibiotics: 'NOT_DETECTED' } } })
  if (officer) {
    await call('POST', `/admin/lab-reviews/${result.reviewId}/decision`, { token: officer.token, body: { decision: 'VERIFIED', password: officer.password, note: 'Values within FSSAI limits' } })
    if (jars) {
      const packBatch = await call('POST', '/platform/pack-batches', { token: k.token, body: { batchCode: harvest.batch_code, jarSizeGrams: 500, quantityToPack: jars } })
      await call('POST', `/platform/pack-batches/${packBatch.packBatchCode}/packs`, { token: k.token, body: { quantity: jars } })
    }
  }
  return harvest.batch_code
}

try {
  console.log('Starting an isolated demo backend…')
  await waitForServer()

  const officers = {
    madurai: { token: await login('region.madurai', 'region@12345'), password: 'region@12345' },
    coimbatore: { token: await login('region.coimbatore', 'region@12345'), password: 'region@12345' },
    kochi: { token: await login('region.kochi', 'region@12345'), password: 'region@12345' },
  }
  const head = await login('kvic.head', 'kvic@12345')
  const tn = await login('state.tn', 'state@12345')

  console.log('Registering companies and recording their work…')
  const a = await keeper('Madurai Wild Honey', 'Tamil Nadu', 'Madurai', '33AAAAA0000A1Z5')
  const b = await keeper('Coimbatore Forest Bees', 'Tamil Nadu', 'Coimbatore')
  const c = await keeper('Kochi Backwater Apiary', 'Kerala', 'Kochi')
  await keeper('Nashik Hive Collective', 'Maharashtra', 'Nashik')

  await call('POST', `/admin/organizations/${a.orgId}/decision`, { token: officers.madurai.token, body: { decision: 'APPROVED', note: 'Documents verified' } })
  await call('POST', `/admin/organizations/${b.orgId}/decision`, { token: officers.coimbatore.token, body: { decision: 'APPROVED' } })
  await call('POST', `/admin/organizations/${c.orgId}/decision`, { token: officers.kochi.token, body: { decision: 'APPROVED' } })

  await verifiedBatch(a, officers.madurai, 2, 12, 20)
  await verifiedBatch(a, officers.madurai, 1, 8, 10)
  await verifiedBatch(b, null, 1, 6, 0)
  await verifiedBatch(c, officers.kochi, 1, 5, 10)

  for (const [k, entries] of [[a, [[-70, 'INCOME', 'Sales income', 'Wholesale order', 42000], [-40, 'INCOME', 'Sales income', 'Retail sales', 28500], [-35, 'EXPENSE', 'Packaging', 'Jars and labels', 6200], [-8, 'INCOME', 'Sales income', 'Festival stall', 19800], [-5, 'EXPENSE', 'Labor', 'Harvest labour', 4500]]], [c, [[-20, 'INCOME', 'Sales income', 'Hotel supply', 15000], [-12, 'EXPENSE', 'Maintenance', 'Hive repair', 1800]]]]) {
    for (const [offset, type, category, description, amount] of entries) {
      await call('POST', '/company/finance', { token: k.token, body: { type, category, description, entryDate: day(offset), amount } })
    }
  }
  const buyer = await call('POST', '/company/buyers', { token: a.token, body: { name: 'Sri Lakshmi Stores', type: 'Retailer', contact: '9000011111' } })
  await call('POST', '/company/invoices', { token: a.token, body: { buyerId: buyer.id, gstPercent: 5, lines: [{ description: 'Wildflower honey 500 g', quantity: 20, unitPrice: 320 }] } })

  const wholesaler = await call('POST', '/company/buyers', { token: b.token, body: { name: 'Coimbatore Honey Traders', type: 'Wholesaler', contact: '9000022222' } })
  const looseBatch = (await call('GET', '/company/sales/stock', { token: b.token })).find((row) => row.availableGrams > 0)
  await call('POST', '/company/sales', { token: b.token, body: { buyerId: wholesaler.id, batchCode: looseBatch.batchCode, quantity: 4, unit: 'kg', pricePerKg: 340, paid: true } })

  console.log('Notices, questions and an inspection…')
  const post = (token, body) => call('POST', '/admin/announcements', { token, body })
  await post(officers.madurai.token, { title: 'Honey testing camp, Madurai', body: 'Free moisture and HMF checks on Friday at the KVIC office.', priority: 'IMPORTANT' })
  await post(tn, { title: 'Monsoon precautions', body: 'Keep hives raised and ventilated during the heavy rains.', audience: { keepers: true, officers: ['REGIONAL_OFFICER'] } })
  await post(head, { title: 'National honey quality drive', body: 'All keepers: keep lab certificates ready for the coming audits.', priority: 'URGENT', audience: { keepers: true, officers: ['STATE_OFFICER', 'REGIONAL_OFFICER'] } })
  await post(head, { title: 'Officers only: audit procedure', body: 'Use the new inspection checklist from this month.', audience: { keepers: false, officers: ['STATE_OFFICER', 'REGIONAL_OFFICER'] } })

  const ticket = await call('POST', '/company/tickets', { token: a.token, body: { subject: 'Where do I add my GSTIN?', message: 'I want my GST number to appear on invoices. Where can I add it?' } })
  await call('POST', `/admin/tickets/${ticket.id}/messages`, { token: officers.madurai.token, body: { body: 'Open Settings, Business details, and save your GSTIN there.' } })
  const escalated = await call('POST', '/company/tickets', { token: a.token, body: { subject: 'Licence renewal rules', message: 'Which documents are needed to renew my FSSAI licence this year?' } })
  await call('POST', `/admin/tickets/${escalated.id}/escalate`, { token: officers.madurai.token, body: { target: 'STATE', reason: 'Needs a policy answer from the state office' } })
  await call('POST', `/admin/tickets/${escalated.id}/messages`, { token: tn, body: { body: 'State note: renewal needs the latest lab report and premises photos.', internal: true } })
  await call('POST', `/admin/tickets/${escalated.id}/escalate`, { token: officers.madurai.token, body: { target: 'CENTRAL', reason: 'Affects many keepers in the region' } })

  const past = await call('POST', '/admin/inspections', { token: officers.madurai.token, body: { orgId: a.orgId, purpose: 'ROUTINE', date: day(1), instructions: 'Keep licences, batch records and stock ready.' } })
  await call('POST', '/admin/inspections', { token: officers.coimbatore.token, body: { orgId: b.orgId, purpose: 'LAB_FAILURE', date: day(3) } })
  const raw = new Database(process.env.DATABASE_FILE)
  raw.prepare('UPDATE inspections SET scheduled_date = ? WHERE id = ?').run(day(-1), past.id)
  raw.close()
  const checklist = Object.fromEntries(['licences', 'apiary', 'extraction', 'storage', 'records', 'packaging', 'stock', 'adulteration'].map((id) => [id, { rating: 'OK', note: '' }]))
  checklist.packaging = { rating: 'MINOR', note: 'FSSAI number missing on two labels' }
  await call('POST', `/admin/inspections/${past.id}/report`, { token: officers.madurai.token, body: { conductedOn: day(0), inspectorName: 'S. Kumar', presentPerson: 'Owner', physicalStockKg: 19.5, grade: 'B', outcome: 'CORRECTIVE_ACTION', correctiveActions: 'Reprint labels with the FSSAI number', correctiveDue: day(14), remarks: 'Well-kept apiary. Fix the label details.', checklist } })

  console.log('Sealing and stopping the demo backend…')
  await call('POST', '/admin/chain/validate', { token: head })
} finally {
  stop()
  await new Promise((resolve) => setTimeout(resolve, 800))
}

const { render } = await import('./jury-explorer.mjs')
const out = path.join(root, 'Honey-Chain-Demo-Explorer.html')
fs.writeFileSync(out, await render(false))
console.log(`\nDemo data written to ${path.relative(root, demoDir)} and explorer to ${out}`)
console.log('Demo keeper usernames start with demo. and use the password demo@12345 (see the users table in the explorer).')
if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', out], { stdio: 'ignore', detached: true }).unref()
