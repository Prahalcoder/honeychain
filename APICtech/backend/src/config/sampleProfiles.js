import { CATEGORIES } from './registration.js'

// Made-up but realistic registration details for demo companies: every company that registered before these
// fields existed, and the demo wholesalers (tools/seedTraders.mjs). Deterministic per seed, so a restart never
// changes them, and always shaped like real form input so it goes through the same checks as a real applicant.
// Everything produced here is stored with is_sample = 1 and labelled "sample" wherever it is shown.

function rng(seed) {
  let state = (Number(seed) * 2654435761) >>> 0 || 1
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = (random, list) => list[Math.floor(random() * list.length)]
const between = (random, min, max) => Math.floor(min + random() * (max - min + 1))
const digits = (random, count) => Array.from({ length: count }, () => Math.floor(random() * 10)).join('')
const letters = (random, count) => Array.from({ length: count }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(random() * 26)]).join('')
const pad = (value) => String(value).padStart(2, '0')
const date = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`

// Verhoeff check digit, as on a real Aadhaar number.
const D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]]
const P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]]
const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9]
function aadhaar(random) {
  const body = `${between(random, 2, 9)}${digits(random, 10)}`
  let check = 0
  ;[...body].reverse().forEach((digit, index) => { check = D[check][P[(index + 1) % 8][Number(digit)]] })
  return `${body}${INV[check]}`
}

const pan = (random, fourth = 'P') => `${letters(random, 3)}${fourth}${letters(random, 1)}${digits(random, 4)}${letters(random, 1)}`

const STATE_CODES = {
  'Tamil Nadu': 'TN', Kerala: 'KL', Karnataka: 'KA', Maharashtra: 'MH', 'Uttar Pradesh': 'UP', Punjab: 'PB', Uttarakhand: 'UT', 'Himachal Pradesh': 'HP',
}

const FIRST_NAMES = {
  south: ['Murugan', 'Selvaraj', 'Anand', 'Karthik', 'Suresh', 'Lakshmi', 'Meena', 'Priya', 'Ravi', 'Arjun', 'Divya', 'Joseph', 'Thomas', 'Anitha', 'Rajesh'],
  west: ['Sachin', 'Pooja', 'Ganesh', 'Sunita', 'Mahesh', 'Rohini', 'Vijay', 'Snehal', 'Ramesh', 'Kavita'],
  north: ['Rajinder', 'Sukhwinder', 'Anil', 'Neha', 'Ramesh', 'Sunita', 'Harpreet', 'Deepak', 'Kamla', 'Vikram', 'Rakesh', 'Geeta', 'Mohan', 'Asha'],
}
const LAST_NAMES = {
  south: ['Pillai', 'Nair', 'Kumar', 'Rajan', 'Subramanian', 'Gowda', 'Hegde', 'Menon', 'Iyer', 'Reddy'],
  west: ['Patil', 'Jadhav', 'Deshmukh', 'Pawar', 'Kulkarni', 'Shinde'],
  north: ['Sharma', 'Singh', 'Thakur', 'Negi', 'Rawat', 'Verma', 'Chauhan', 'Yadav', 'Gill', 'Bisht'],
}
const zone = (state) => (['Tamil Nadu', 'Kerala', 'Karnataka'].includes(state) ? 'south' : state === 'Maharashtra' ? 'west' : 'north')
const personName = (random, state) => `${pick(random, FIRST_NAMES[zone(state)])} ${pick(random, LAST_NAMES[zone(state)])}`

const BANKS = [
  { name: 'State Bank of India', ifsc: 'SBIN0' },
  { name: 'Canara Bank', ifsc: 'CNRB0' },
  { name: 'Punjab National Bank', ifsc: 'PUNB0' },
  { name: 'Indian Bank', ifsc: 'IDIB0' },
  { name: 'Bank of Baroda', ifsc: 'BARB0' },
  { name: 'Union Bank of India', ifsc: 'UBIN0' },
  { name: 'HDFC Bank', ifsc: 'HDFC0' },
]

// Hill states keep Apis cerana, the plains keep A. mellifera boxes, the south also has stingless bees.
function speciesFor(random, state) {
  if (['Himachal Pradesh', 'Uttarakhand'].includes(state)) return random() < 0.6 ? ['Apis cerana', 'Apis mellifera'] : ['Apis cerana']
  if (['Kerala', 'Tamil Nadu', 'Karnataka'].includes(state)) return random() < 0.5 ? ['Apis cerana', 'Trigona (stingless bee)'] : ['Apis cerana', 'Apis mellifera']
  return random() < 0.7 ? ['Apis mellifera'] : ['Apis mellifera', 'Apis cerana']
}

const MIGRATION_CROPS = {
  'Himachal Pradesh': ['Apple orchards', 'Mustard', 'Litchi'],
  Uttarakhand: ['Litchi', 'Mustard', 'Sheesham'],
  Punjab: ['Mustard', 'Berseem', 'Eucalyptus'],
  'Uttar Pradesh': ['Mustard', 'Litchi', 'Eucalyptus'],
  Maharashtra: ['Sunflower', 'Jamun', 'Karvi'],
  Karnataka: ['Coffee blossom', 'Sunflower', 'Coconut'],
  Kerala: ['Rubber', 'Coconut', 'Cardamom'],
  'Tamil Nadu': ['Coconut', 'Sunflower', 'Moringa'],
}

// Which way of registering fits a company's name best. Where the name leaves it open, the company id spreads the
// demo companies over every category, the way real ones are (collectives register as a society or as a producer
// company, some apiaries are run as a firm).
export function categoryFor(org) {
  if (org.organization_type === 'TRADER') return 'WHOLESALER'
  const name = String(org.legal_name || '')
  const id = Number(org.id) || 0
  if (/producer|fpo|fpc|pvt|private|ltd|limited|company/i.test(name)) return 'COMPANY'
  if (/society|co-?op|sangam|sangh|samiti|mahila|shg/i.test(name)) return 'SOCIETY'
  if (/collective/i.test(name)) return id % 3 === 0 ? 'COMPANY' : 'SOCIETY'
  if (org.organization_type === 'ORG_BEEKEEPER') return 'SOCIETY'
  if (org.organization_type === 'LOCAL_STARTUP' || /farms|enterprise|traders|& ?sons|brothers|foods|& ?co/i.test(name)) return 'FIRM'
  return id % 4 === 0 ? 'FIRM' : 'INDIVIDUAL'
}

function beekeeping(random, state, category) {
  const big = ['SOCIETY', 'COMPANY'].includes(category)
  const colonies = big ? between(random, 120, 900) : between(random, 12, 180)
  const from = between(random, 0, 11)
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const trainings = [
    { name: 'Basic beekeeping training', organisedBy: pick(random, ['KVIC / State KVIB', 'National Bee Board (NBB)', 'ICAR / Krishi Vigyan Kendra (KVK)']) },
    ...(random() < 0.6 ? [{ name: pick(random, ['Queen rearing', 'Bee disease and pest management', 'Honey extraction, processing and quality', 'Migratory beekeeping']), organisedBy: pick(random, ['State Horticulture Department', 'State Agricultural University', 'National Bee Board (NBB)']) }] : []),
  ]
  const planIncrease = random() < 0.65
  return {
    colonies,
    species: speciesFor(random, state),
    experienceYears: big ? between(random, 5, 25) : between(random, 2, 30),
    planIncrease,
    planText: planIncrease ? `Add about ${Math.round(colonies * (0.2 + random() * 0.4))} colonies over two seasons by splitting strong colonies and buying nucleus boxes.` : '',
    fpo: random() < 0.45 ? { member: true, name: `${pick(random, ['Madhu', 'Shahad', 'Then', 'Jenu'])} Beekeepers FPO`, regNo: `FPO/${STATE_CODES[state]}/${between(random, 2016, 2023)}/${digits(random, 4)}`, contact: `9${digits(random, 9)}` } : { member: false },
    land: random() < 0.75 ? { type: pick(random, ['Self owned', 'Leased']), state, district: '' } : { type: 'Landless' },
    migration: random() < 0.6 ? { from: months[from], to: months[(from + between(random, 1, 3)) % 12], mainCrop: pick(random, MIGRATION_CROPS[state] || ['Mustard']) } : undefined,
    training: trainings,
  }
}

function production(random, colonies) {
  const produced = Math.round(colonies * (8 + random() * 16))
  const sold = Math.round(produced * (0.7 + random() * 0.25))
  const other = {}
  if (random() < 0.8) other.wax = { produced: Math.round(colonies * 0.4), sold: Math.round(colonies * 0.3), price: between(random, 350, 600) }
  if (random() < 0.4) other.pollen = { produced: Math.round(colonies * 0.1 * 10) / 10, sold: Math.round(colonies * 0.08 * 10) / 10, price: between(random, 800, 1600) }
  if (random() < 0.3) other.propolis = { produced: Math.round(colonies * 0.05 * 10) / 10, sold: Math.round(colonies * 0.04 * 10) / 10, price: between(random, 1500, 3500) }
  return {
    honeyProducedKg: produced,
    honeySoldKg: sold,
    avgPriceKg: between(random, 240, 560),
    soldTo: [pick(random, ['Aggregator', 'Trader', 'Processing unit']), ...(random() < 0.4 ? ['Packaging / marketing company'] : [])],
    coloniesMultiplied: Math.round(colonies * random() * 0.3),
    coloniesSold: Math.round(colonies * random() * 0.1),
    avgPriceColony: between(random, 2500, 4500),
    hivesManufactured: random() < 0.3 ? between(random, 5, 40) : 0,
    hivesSold: 0,
    avgPriceHive: 0,
    other,
  }
}

function quality(random) {
  const medicines = random() < 0.25
  return {
    medicinesUsed: medicines,
    medicinesDetails: medicines ? pick(random, ['Formic acid strips against Varroa mite', 'Oxalic acid treatment for mites', 'Sulphur dusting against wax moth']) : '',
    antibioticsUsed: false,
    supplier: medicines ? 'State Horticulture Department apiary unit' : '',
    withdrawalPeriod: medicines ? 'No honey super on the colony during treatment and 4 weeks after' : '',
    recordsMaintained: random() < 0.85,
    purchaseBillsAvailable: random() < 0.7,
    qualityEquipment: true,
    containers: { count: between(random, 10, 80), capacityKg: pick(random, [25, 30, 50]), type: pick(random, ['Food grade plastic', 'Stainless steel']) },
  }
}

function entity(random, category, state, name) {
  const code = STATE_CODES[state] || 'IN'
  const year = between(random, 2008, 2022)
  const kinds = CATEGORIES[category].entityKinds
  const kind = category === 'COMPANY' && /producer|fpo|fpc/i.test(name) ? 'Farmer Producer Company (FPC)' : pick(random, kinds)
  const out = { kind, registrationNo: `${{ FIRM: 'FIRM', SOCIETY: 'SOC', COMPANY: 'ROC', WHOLESALER: 'TRD' }[category]}/${code}/${year}/${digits(random, 5)}`, registrationDate: date(year, between(random, 1, 12), between(random, 1, 28)) }
  if (category === 'COMPANY' || (category === 'WHOLESALER' && /company|LLP/i.test(kind))) out.cin = `U${pick(random, ['01403', '01500', '10792', '46309'])}${code}${year}${pick(random, ['PTC', 'PLC', 'FTC'])}${digits(random, 6)}`
  if (category === 'SOCIETY') out.membersCount = between(random, 25, 400)
  if (category === 'WHOLESALER' && kind === 'Proprietorship') { out.registrationNo = ''; out.registrationDate = '' }
  return out
}

// Raw registration-form input (the `profile` part of POST /auth/register) for one company.
export function sampleProfileInput({ seed, category, state, district = '', address = '', name = '' }) {
  const random = rng(seed)
  const individual = category === 'INDIVIDUAL'
  const bank = pick(random, BANKS)
  const nomineeYear = between(random, 1965, 2004)
  const holder = personName(random, state)

  const input = {
    applicant: {
      fatherHusbandName: personName(random, state),
      dob: date(between(random, 1962, 1996), between(random, 1, 12), between(random, 1, 28)),
      gender: random() < 0.72 ? 'Male' : 'Female',
      education: pick(random, ['10th', '12th', 'Graduate', 'Graduate', 'Post Graduate', 'Illiterate']),
      socialCategory: pick(random, ['General', 'General', 'SC', 'ST']),
      aadhaar: aadhaar(random),
      pan: individual ? '' : pan(random, category === 'COMPANY' ? 'C' : category === 'SOCIETY' ? 'A' : 'F'),
      altPhone: random() < 0.4 ? `${pick(random, [9, 8, 7])}${digits(random, 9)}` : '',
    },
    nominee: { name: personName(random, state), dob: date(nomineeYear, between(random, 1, 12), between(random, 1, 28)), relation: pick(random, ['Spouse', 'Son', 'Daughter', 'Brother', 'Father']) },
    bank: { holderName: individual ? '' : (name || holder), bankName: bank.name, ifsc: `${bank.ifsc}${digits(random, 6)}`, accountNumber: digits(random, between(random, 11, 16)).replace(/^0/, '3') },
    business: { state, district, address },
  }

  if (!individual) {
    input.entity = entity(random, category, state, name)
    input.authorised = {
      name: personName(random, state),
      designation: { FIRM: 'Managing Partner', SOCIETY: pick(random, ['Secretary', 'President']), COMPANY: pick(random, ['Director', 'Chief Executive Officer']), WHOLESALER: pick(random, ['Proprietor', 'Partner', 'Director']) }[category],
      aadhaar: aadhaar(random),
    }
  }

  if (category === 'WHOLESALER') {
    input.trade = {
      businessType: pick(random, ['Aggregator', 'Processing unit', 'Packaging / marketing company', 'Exporter', 'Trader / distributor']),
      tradeLicenceNo: `TL/${STATE_CODES[state] || 'IN'}/${between(random, 2015, 2024)}/${digits(random, 5)}`,
      iec: random() < 0.35 ? `${letters(random, 5)}${digits(random, 5)}` : '',
      apedaNo: '',
      fssaiCategory: pick(random, ['State licence', 'Central licence']),
      storageCapacityKg: pick(random, [5000, 10000, 20000, 50000]),
      monthlyPurchaseKg: pick(random, [1000, 2500, 5000, 10000]),
      warehouseAddress: address || `Godown ${between(random, 1, 40)}, APMC market yard, ${district || state}`,
      sourcingStates: [state, ...(random() < 0.5 ? [pick(random, Object.keys(STATE_CODES).filter((item) => item !== state))] : [])],
      honeyTypes: [],
      brandName: random() < 0.6 ? `${pick(random, ['Nectar', 'Vana', 'Madhu', 'Golden Comb', 'Pure Hill'])} ${pick(random, ['Honey', 'Naturals', 'Foods'])}` : '',
      packagingTypes: [pick(random, ['Glass jars', 'PET / food grade plastic jars', 'Bulk drums / buckets'])],
      preferredSellers: 'Lab-verified multifloral and single-flower honey from registered beekeepers.',
    }
  } else {
    const bee = beekeeping(random, state, category)
    if (bee.land.type !== 'Landless') bee.land.district = district
    input.beekeeping = bee
    input.production = production(random, bee.colonies)
    input.quality = quality(random)
  }

  return input
}
