import { REGIONS } from './regions.js'

// Sample addresses. The streets, house numbers and e-mail addresses below are made up (marked "sample"
// in the database and on screen); the city post-office PIN codes are the real ones for each town.
const REGION_PIN = {
  Madurai: '625001', Coimbatore: '641001', Chennai: '600001', Salem: '636001',
  Thiruvananthapuram: '695001', Kochi: '682001', Kozhikode: '673001',
  Bengaluru: '560001', Mysuru: '570001', Belagavi: '590001',
  Pune: '411001', Nashik: '422001', Nagpur: '440001',
  Lucknow: '226001', Varanasi: '221001', Agra: '282001',
  Ludhiana: '141001', Amritsar: '143001',
  Dehradun: '248001', Haldwani: '263139',
  Shimla: '171001', Kullu: '175101',
}

// State offices sit in the state capital.
const CAPITAL = {
  'Tamil Nadu': { city: 'Chennai', pin: '600001' },
  Kerala: { city: 'Thiruvananthapuram', pin: '695001' },
  Karnataka: { city: 'Bengaluru', pin: '560001' },
  Maharashtra: { city: 'Mumbai', pin: '400001' },
  'Uttar Pradesh': { city: 'Lucknow', pin: '226001' },
  Punjab: { city: 'Chandigarh', pin: '160017' },
  Uttarakhand: { city: 'Dehradun', pin: '248001' },
  'Himachal Pradesh': { city: 'Shimla', pin: '171001' },
}

const STREETS = ['Gandhi Road', 'Nehru Street', 'Anna Salai', 'Temple Road', 'Market Road', 'Station Road', 'Lake View Road',
  'Subhash Nagar Main Road', 'Rose Garden Lane', 'Mill Road', 'Canal Bank Road', 'College Road']
const LOCALITIES = ['Gandhi Nagar', 'Kamarajar Colony', 'Rajaji Nagar', 'Bharathi Nagar', 'Green Park', 'Model Town', 'Civil Lines', 'Shanti Nagar']

// A stable number from a text, so the same input always gives the same sample address.
function pick(text, modulo) {
  let hash = 0
  for (const char of String(text)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash % modulo
}

export const pinForRegion = (region) => REGION_PIN[region] || ''

// A made-up address for a keeper in this state and region.
export function sampleAddress(state, region, seed = '') {
  const key = `${state}|${region}|${seed}`
  return {
    addressLine: `${1 + pick(key, 180)}, ${STREETS[pick(`${key}s`, STREETS.length)]}`,
    locality: LOCALITIES[pick(`${key}l`, LOCALITIES.length)],
    district: region || CAPITAL[state]?.city || '',
    pincode: REGION_PIN[region] || CAPITAL[state]?.pin || '',
  }
}

// The offices to create at start-up: one central, one per state, one per KVIC region.
export function officeSeeds() {
  const offices = [{
    level: 'CENTRAL', state: '', region: '', name: 'KVIC Head Office (Central Office)',
    addressLine: 'Gramodaya, 3, Irla Road, Vile Parle (West)', locality: 'Vile Parle', district: 'Mumbai', pincode: '400056',
    email: 'central.office@kvic.example', isSample: 0,
  }]

  for (const [state, regions] of Object.entries(REGIONS)) {
    const capital = CAPITAL[state]
    offices.push({
      level: 'STATE', state, region: '', name: `KVIC State Office, ${state}`,
      addressLine: `${10 + pick(state, 80)}, ${STREETS[pick(`${state}o`, STREETS.length)]}`, locality: 'Government Offices Area', district: capital.city, pincode: capital.pin,
      email: `state.${state.toLowerCase().replace(/\s+/g, '-')}@kvic.example`, isSample: 1,
    })

    for (const region of regions) {
      offices.push({
        level: 'REGIONAL', state, region, name: `KVIC Regional Office, ${region}`,
        addressLine: `${5 + pick(region, 120)}, ${STREETS[pick(`${region}o`, STREETS.length)]}`, locality: LOCALITIES[pick(`${region}x`, LOCALITIES.length)], district: region, pincode: REGION_PIN[region] || capital.pin,
        email: `region.${region.toLowerCase().replace(/\s+/g, '-')}@kvic.example`, isSample: 1,
      })
    }
  }
  return offices
}

// One line, for lists and labels.
export function formatAddress(parts) {
  const { addressLine, locality, district, state, pincode } = parts
  const place = [locality, district && district !== locality ? district : ''].filter(Boolean).join(', ')
  const tail = [state, pincode].filter(Boolean).join(' - ')
  return [addressLine, place, tail].filter(Boolean).join(', ')
}
