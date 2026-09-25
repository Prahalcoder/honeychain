// Demo wholesalers: one registered honey trader / packer in every KVIC region (22 regions, 22 wholesalers).
//
//   npm run seed:traders   registers each wholesaler exactly as the Keeper app's registration form does
//                          ("Wholesaler / trader / packer"), with made-up Madhukranti-style details, and has the
//                          region's demo officer approve it so it can browse the market and send offers.
//
// Login: trader.<region> / Trader@12345 (for example trader.madurai). The API must be running (npm start).
// Safe to run again: wholesalers that exist are skipped (and approved if they are still pending).
import { REGIONS, regionalUsername } from '../APICtech/backend/src/config/regions.js'
import { sampleAddress } from '../APICtech/backend/src/config/sampleData.js'
import { sampleProfileInput } from '../APICtech/backend/src/config/sampleProfiles.js'

const API = process.env.API_URL || 'http://localhost:5000/api'
const TRADER_PASSWORD = 'Trader@12345'
const OFFICER_PASSWORD = 'region@12345'

// GST state codes, the first two digits of a GSTIN.
const GST_STATE = { 'Tamil Nadu': '33', Kerala: '32', Karnataka: '29', Maharashtra: '27', 'Uttar Pradesh': '09', Punjab: '03', Uttarakhand: '05', 'Himachal Pradesh': '02' }
const OWNERS = ['Senthil Kumar', 'Abdul Rahman', 'Prakash Jain', 'Mehul Shah', 'Varghese Kurian', 'Anand Rao', 'Raghav Agarwal', 'Nitin Gupta', 'Farhan Qureshi', 'Manpreet Arora', 'Sanjay Bansal']
const BRANDS = ['Honey Traders', 'Agro Foods', 'Natural Products', 'Honey House', 'Bee Products LLP', 'Food Exports']

const slug = (text) => text.toLowerCase().replace(/\s+/g, '-')

async function call(method, route, { token, body } = {}, attempt = 0) {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  // The API limits sign-ins and sign-ups per address; wait for the window to pass instead of failing.
  if (res.status === 429 && attempt < 6 && route.startsWith('/auth/')) {
    console.log('  (the API asked to slow down, waiting a minute)')
    await new Promise((resolve) => setTimeout(resolve, 60000))
    return await call(method, route, { token, body }, attempt + 1)
  }
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

function traderList() {
  const traders = []
  let number = 0
  for (const [state, regions] of Object.entries(REGIONS)) {
    for (const region of regions) {
      number += 1
      const address = sampleAddress(state, region, 'trader')
      const profile = sampleProfileInput({ seed: 5000 + number, category: 'WHOLESALER', state, district: address.district, address: address.addressLine, name: region })
      // The GSTIN carries the business PAN, as a real one does.
      const pan = profile.applicant.pan
      traders.push({
        number, state, region, address, profile,
        username: `trader.${slug(region)}`,
        ownerName: OWNERS[(number - 1) % OWNERS.length],
        organizationName: `${region} ${BRANDS[(number - 1) % BRANDS.length]}`,
        registrationId: `NBB-DEMO-TR-${String(number).padStart(2, '0')}`,
        fssai: `1150${String(number).padStart(2, '0')}00000000`,
        gstin: `${GST_STATE[state]}${pan}1Z${number % 10}`,
        phone: `8${String(300000000 + number * 6007).slice(0, 9)}`,
      })
    }
  }
  return traders
}

async function register(trader) {
  const existing = await call('POST', '/auth/login', { body: { username: trader.username, password: TRADER_PASSWORD } })
  if (existing.status === 200) return { state: 'exists', user: existing.json.user }

  const result = await call('POST', '/auth/register', {
    body: {
      category: 'WHOLESALER', profile: trader.profile,
      name: trader.ownerName, username: trader.username, password: TRADER_PASSWORD,
      organizationName: trader.organizationName, registrationId: trader.registrationId,
      fssaiLicense: trader.fssai, gstin: trader.gstin,
      state: trader.state, region: trader.region, email: `${trader.username}@example.com`, phone: trader.phone,
      addressLine: trader.address.addressLine, locality: trader.address.locality, district: trader.address.district, pincode: trader.address.pincode,
    },
  })
  if (result.status === 409) return { state: 'exists' }
  if (result.status !== 201) throw new Error(`${trader.username}: ${result.status} ${result.json.message || ''}`)
  return { state: 'registered', user: result.json.user }
}

const officers = new Map()
async function officerToken(region) {
  if (!officers.has(region)) officers.set(region, (await call('POST', '/auth/login', { body: { username: regionalUsername(region), password: OFFICER_PASSWORD } })).json.token)
  return officers.get(region)
}

async function approve(trader, organization) {
  if (!organization?.id || organization.status !== 'PENDING_APPROVAL') return false
  const result = await call('POST', `/admin/organizations/${organization.id}/decision`, {
    token: await officerToken(trader.region),
    body: { decision: 'APPROVED', note: 'Demo wholesaler: approved by the regional officer login.' },
  })
  if (result.status >= 300) throw new Error(`${trader.username} approval: ${result.json.message}`)
  return true
}

const traders = traderList()
let added = 0
let approved = 0
for (const trader of traders) {
  const { state, user } = await register(trader)
  if (state === 'registered') added += 1
  if (await approve(trader, user?.organization)) approved += 1
  console.log(`  ${trader.username.padEnd(30)} ${state}${user?.organization?.status === 'PENDING_APPROVAL' ? ', approved' : ''}`)
}
console.log(`\nDone: ${added} new, ${approved} approved. Log in to the Keeper app as a wholesaler, for example trader.madurai / ${TRADER_PASSWORD}.`)
