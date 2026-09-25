// Demo farms for every KVIC region: two per region (22 regions, 44 farms).
//
//   npm run seed:farms             registers the farms exactly as a beekeeper would in the Keeper app.
//                                  They wait as "pending" in Admin > Organisations, so the regional officer approves them.
//   npm run seed:farms -- --stock  for farms that are already approved: records two harvests of the region's special honey,
//                                  a lab result, the regional officer's verification, jars with QR codes, and puts the
//                                  jars on Sellers nearby. (It uses the demo officer logins, so it is for demos only.)
//
// The API must be running (npm start). Safe to run again: farms that exist are skipped.
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { REGIONS, regionalUsername } from '../APICtech/backend/src/config/regions.js'
import { sampleAddress } from '../APICtech/backend/src/config/sampleData.js'
import { referencePrice, specialtiesFor } from '../APICtech/backend/src/config/honeyCatalogue.js'
import { categoryFor, sampleProfileInput } from '../APICtech/backend/src/config/sampleProfiles.js'

const root = path.dirname(fileURLToPath(import.meta.url))
const API = process.env.API_URL || 'http://localhost:5000/api'
const FARM_PASSWORD = 'Farm@12345'
const OFFICER_PASSWORD = 'region@12345'
const STOCK = process.argv.includes('--stock')
const today = new Date().toLocaleDateString('en-CA')

const OWNERS = ['Ramesh Kumar', 'Lakshmi Devi', 'Suresh Babu', 'Meena Iyer', 'Anil Sharma', 'Sunita Verma', 'Gurpreet Singh', 'Harjot Kaur', 'Mohan Rawat',
  'Kavita Negi', 'Ravi Patil', 'Sneha Kulkarni', 'Vijay Nair', 'Anitha Menon', 'Prakash Gowda', 'Deepa Hegde', 'Manoj Yadav', 'Rekha Mishra', 'Tenzin Dorje', 'Pooja Thakur', 'Arun Prasad', 'Nisha Joshi',
  'Karthik Raja', 'Divya Bharathi', 'Imran Khan', 'Farida Begum', 'Balwinder Sidhu', 'Simran Kaur', 'Dinesh Bisht', 'Geeta Pant', 'Rohit Deshmukh', 'Madhuri Pawar', 'Shibu Thomas', 'Latha Pillai',
  'Nagaraj Shetty', 'Vani Rao', 'Sanjay Tripathi', 'Usha Pandey', 'Kishore Chand', 'Anjali Sood', 'Muthu Vel', 'Selvi Amma', 'Basavaraj Patil', 'Rukmini Desai']

const slug = (text) => text.toLowerCase().replace(/\s+/g, '-')

async function call(method, route, { token, body } = {}, attempt = 0) {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  // The API limits sign-ins per address; wait for the window to pass instead of failing.
  if (res.status === 429 && attempt < 6 && route.startsWith('/auth/login')) {
    console.log('  (the API asked to slow down, waiting a minute)')
    await new Promise((resolve) => setTimeout(resolve, 60000))
    return await call(method, route, { token, body }, attempt + 1)
  }
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

// Every farm to create, in a fixed order so a re-run finds the same ones.
function farmList() {
  const farms = []
  let number = 0
  for (const [state, regions] of Object.entries(REGIONS)) {
    regions.forEach((region, regionIndex) => {
      for (const farm of [1, 2]) {
        number += 1
        const type = farm === 1 ? 'KVIC_BEEKEEPER' : (number % 4 === 0 ? 'LOCAL_STARTUP' : 'ORG_BEEKEEPER')
        const specialties = specialtiesFor(state)
        const address = sampleAddress(state, region, `farm${farm}`)
        farms.push({
          number, state, region, farm,
          username: `farm.${slug(region)}.${farm}`,
          ownerName: OWNERS[(number - 1) % OWNERS.length],
          organizationName: farm === 1 ? `${region} Hill Apiary` : `${region} Natural Honey Collective`,
          organizationType: type,
          registrationBody: type === 'KVIC_BEEKEEPER' ? '' : (type === 'ORG_BEEKEEPER' ? `${region} Bee Farmers FPO (sample)` : 'FSSAI-registered startup (sample)'),
          registrationId: `MK-DEMO-${String(number).padStart(2, '0')}-${farm}`,
          fssai: `2260${String(number).padStart(2, '0')}${farm}0000000`,
          phone: `9${String(400000000 + number * 7919).slice(0, 9)}`,
          address,
          honey: specialties[(farm - 1) % Math.max(1, specialties.length)],
          regionIndex,
        })
      }
    })
  }
  return farms
}

async function register(farm) {
  // A farm that can already sign in exists: skip it (registering again would only use up the hourly limit).
  const existing = await call('POST', '/auth/login', { body: { username: farm.username, password: FARM_PASSWORD } })
  if (existing.status === 200) return 'exists'

  // The full registration form, filled with made-up details (the API marks MK-DEMO-* companies as samples).
  const category = categoryFor({ id: farm.number, legal_name: farm.organizationName, organization_type: farm.organizationType })
  const profile = sampleProfileInput({ seed: 1000 + farm.number, category, state: farm.state, district: farm.address.district, address: farm.address.addressLine, name: farm.organizationName })
  const result = await call('POST', '/auth/register', {
    body: {
      category, profile,
      name: farm.ownerName, username: farm.username, password: FARM_PASSWORD,
      organizationName: farm.organizationName, organizationType: farm.organizationType,
      registrationId: farm.registrationId, registrationBody: farm.registrationBody, fssaiLicense: farm.fssai, gstin: '',
      state: farm.state, region: farm.region, email: `${farm.username}@example.com`, phone: farm.phone,
      addressLine: farm.address.addressLine, locality: farm.address.locality, district: farm.address.district, pincode: farm.address.pincode,
    },
  })
  if (result.status === 409) return 'exists'
  if (result.status === 429) return 'limit'
  if (result.status !== 201) throw new Error(`${farm.username}: ${result.status} ${result.json.message || ''}`)
  return 'registered'
}

// The addresses above are made up: mark them as samples, the same way the app does for its own sample addresses.
async function flagSamples() {
  try {
    const require = createRequire(path.join(root, '../APICtech/backend/package.json'))
    const pg = require('pg')
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54329/honeychain' })
    await pool.query("UPDATE organizations SET address_sample = 1 WHERE madhukranti_id LIKE 'MK-DEMO-%'")
    await pool.end()
  } catch (error) {
    console.log(`  (could not mark the addresses as samples: ${error.message})`)
  }
}

let officers = new Map()
async function officerToken(region) {
  if (!officers.has(region)) officers.set(region, (await call('POST', '/auth/login', { body: { username: regionalUsername(region), password: OFFICER_PASSWORD } })).json.token)
  return officers.get(region)
}

const daysAgo = (days) => new Date(Date.now() - days * 86400000).toLocaleDateString('en-CA')

// One harvest, from the hive to the shop: harvest, lab result, the officer's verification, jars with QR codes, a listing.
async function harvestAndSell(token, farm, hiveCode, { honey, kg, date, jarGrams, maxJars, label }) {
  const harvest = await call('POST', '/company/harvests', { token, body: { hiveCode, harvestDate: date, quantityKg: kg, honeyType: honey.type, location: farm.address.locality } })
  if (harvest.status >= 300) throw new Error(`${farm.username} harvest: ${harvest.json.message}`)
  const batchCode = harvest.json.batch_code

  const request = (await call('POST', '/company/lab-requests', { token, body: { batchCode, labName: 'NABL accredited honey lab (sample)' } })).json
  const result = await call('POST', `/company/lab-requests/${request.requestId}/result`, { token, body: {
    certificateReference: `DEMO-${String(farm.number).padStart(3, '0')}-${batchCode}`, status: 'PASSED', testedAt: date,
    results: { moisturePercent: 17.2, hmfMgPerKg: 14, sucrosePercent: 2.1, antibiotics: 'NOT_DETECTED' },
  } })
  if (result.status >= 300) throw new Error(`${farm.username} lab result: ${result.json.message}`)

  const review = await call('POST', `/admin/lab-reviews/${result.json.reviewId}/decision`, { token: await officerToken(farm.region), body: { decision: 'VERIFIED', password: OFFICER_PASSWORD, note: 'Demo data: verified by the regional officer login.' } })
  if (review.status >= 300) throw new Error(`${farm.username} verification: ${review.json.message}`)

  const jars = Math.min(maxJars, Math.floor((kg * 1000 * 0.8) / jarGrams))
  const lot = await call('POST', '/platform/pack-batches', { token, body: { batchCode, productName: honey.type, jarSizeGrams: jarGrams, quantityToPack: jars } })
  if (lot.status >= 300) throw new Error(`${farm.username} packaging: ${lot.json.message}`)
  await call('POST', `/platform/pack-batches/${lot.json.packBatchCode}/packs`, { token, body: { quantity: jars } })

  const price = referencePrice(honey, jarGrams)
  const listing = await call('POST', '/company/shop/products', { token, body: { packBatchCode: lot.json.packBatchCode, price, quantity: jars, title: `${honey.type} ${jarGrams} g` } })
  if (listing.status >= 300) throw new Error(`${farm.username} shop: ${listing.json.message}`)
  return `${label}: ${kg} kg ${honey.type} (${batchCode}), ${jars} x ${jarGrams} g jars at Rs ${price}`
}

// Two demo harvests per farm: the region's special honey in 500 g jars, and a smaller second harvest (the state's other
// special honey when there is one, otherwise the same honey) in 250 g jars.
async function stock(farm) {
  const login = await call('POST', '/auth/login', { body: { username: farm.username, password: FARM_PASSWORD } })
  if (login.status !== 200) return 'not registered'
  const token = login.json.token
  const me = await call('GET', '/auth/me', { token })
  const status = me.json.user?.organization?.status
  if (status !== 'APPROVED') return `waiting for approval (${status || 'unknown'})`

  const inventory = (await call('GET', '/company/inventory', { token })).json
  if ((inventory.items || []).length > 0) return 'already stocked'

  const hive = (await call('POST', '/company/hives', { token, body: {} })).json
  const others = specialtiesFor(farm.state).filter((item) => item.type !== farm.honey.type)
  const second = others[0] || farm.honey

  const first = await harvestAndSell(token, farm, hive.hive_code, { honey: farm.honey, kg: 10 + (farm.number % 6) * 2, date: daysAgo(6), jarGrams: 500, maxJars: 24, label: 'stocked' })
  const extra = await harvestAndSell(token, farm, hive.hive_code, { honey: second, kg: 6, date: daysAgo(1), jarGrams: 250, maxJars: 16, label: 'and' })
  return `${first}; ${extra}`
}

const farms = farmList()
console.log(`${farms.length} farms in ${new Set(farms.map((farm) => `${farm.state}/${farm.region}`)).size} regions (API ${API})`)

if (!STOCK) {
  let added = 0
  for (const farm of farms) {
    const outcome = await register(farm)
    if (outcome === 'limit') {
      console.log('The API allows 50 registrations per hour from one address. Run this command again in an hour to add the rest,')
      console.log('or add REGISTER_RATE_LIMIT=200 to APICtech/backend/.env and restart npm start.')
      break
    }
    if (outcome === 'registered') added += 1
    console.log(`  ${outcome.padEnd(10)} ${farm.state} / ${farm.region}: ${farm.organizationName} (${farm.username})`)
  }
  await flagSamples()
  console.log(`\nDone: ${added} new, ${farms.length - added} already there. Log in to the Admin portal as a regional officer (for example region.madurai / ${OFFICER_PASSWORD}) > Organisations to approve them.`)
  console.log(`Farm logins: <username> / ${FARM_PASSWORD}. After approving, run: npm run seed:farms -- --stock`)
} else {
  const counts = new Map()
  for (const farm of farms) {
    let outcome
    try { outcome = await stock(farm) } catch (error) { outcome = `FAILED ${error.message}` }
    const key = outcome.split(':')[0].split(' (')[0]
    counts.set(key, (counts.get(key) || 0) + 1)
    console.log(`  ${farm.region} / ${farm.username}: ${outcome}`)
  }
  console.log('\nSummary:', Object.fromEntries(counts))
}
