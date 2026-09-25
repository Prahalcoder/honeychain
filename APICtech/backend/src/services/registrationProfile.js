import {
  BEE_SPECIES, BUSINESS_TYPES, CATEGORIES, CONTAINER_TYPES, EDUCATION, GENDERS, LAND_TYPES, MONTHS, NOMINEE_RELATIONS,
  OTHER_PRODUCTS, PACKAGING_TYPES, SOCIAL_CATEGORIES, SOLD_TO, SOURCING_STATES, TRAINING_NAMES, TRAINING_ORGANISERS,
} from '../config/registration.js'
import { REGIONS } from '../config/regions.js'

// Turns the details a keeper / wholesaler typed on the registration form into what is stored, and refuses an
// application that is missing something its category needs. Identity numbers are checked, but only what an
// officer needs is kept: the last 4 digits of an Aadhaar number and of a bank account, never the full numbers.
export class RegistrationError extends Error {
  constructor(message) {
    super(message)
    this.status = 400
  }
}

const fail = (message) => { throw new RegistrationError(message) }
export const text = (value, max = 200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const yes = (value) => value === true || /^(true|yes|y|1)$/i.test(String(value ?? ''))
const isBlank = (value) => value === undefined || value === null || String(value).trim() === ''

function number(value, label, { min = 0, max = 1e9, integer = false, required = false } = {}) {
  if (isBlank(value)) {
    if (required) fail(`Enter ${label}`)
    return null
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
    fail(`${label[0].toUpperCase()}${label.slice(1)} must be ${integer ? 'a whole number' : 'a number'} between ${min} and ${max}`)
  }
  return parsed
}

function choice(list, value, label, required = false) {
  const chosen = text(value, 80)
  if (!chosen) {
    if (required) fail(`Choose ${label}`)
    return ''
  }
  if (!list.includes(chosen)) fail(`Choose ${label} from the list`)
  return chosen
}

function choices(list, values, label, { required = false } = {}) {
  const chosen = [...new Set((Array.isArray(values) ? values : []).map((item) => text(item, 80)).filter(Boolean))]
  if (chosen.some((item) => !list.includes(item))) fail(`Choose ${label} from the list`)
  if (required && chosen.length === 0) fail(`Choose ${label}`)
  return chosen
}

function isoDate(value, label, { required = false, minAge = null, maxAge = null, notFuture = false } = {}) {
  const raw = text(value, 10)
  if (!raw) {
    if (required) fail(`Enter ${label}`)
    return ''
  }
  const parsed = Date.parse(`${raw}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== raw) fail(`${label[0].toUpperCase()}${label.slice(1)} is not a valid date`)
  if (notFuture && parsed > Date.now()) fail(`${label[0].toUpperCase()}${label.slice(1)} cannot be in the future`)
  if (minAge !== null || maxAge !== null) {
    const age = (Date.now() - parsed) / (365.25 * 24 * 3600 * 1000)
    if (minAge !== null && age < minAge) fail(`The applicant must be at least ${minAge} years old`)
    if (maxAge !== null && age > maxAge) fail(`${label[0].toUpperCase()}${label.slice(1)} looks wrong (more than ${maxAge} years ago)`)
  }
  return raw
}

// Verhoeff check digit, the one Aadhaar numbers use, so a mistyped number is caught before it is submitted.
const D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]]
const P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]]
export function validAadhaar(value) {
  const digits = String(value || '').replace(/\s+/g, '')
  if (!/^[2-9]\d{11}$/.test(digits)) return false
  let check = 0
  ;[...digits].reverse().forEach((digit, index) => { check = D[check][P[index % 8][Number(digit)]] })
  return check === 0
}

function aadhaarLast4(value, label, required, kept = '') {
  if (isBlank(value)) {
    // Editing a saved profile: only the last 4 digits were kept, so a blank field means "unchanged".
    if (kept) return kept
    if (required) fail(`Enter ${label}`)
    return ''
  }
  if (!validAadhaar(value)) fail(`${label[0].toUpperCase()}${label.slice(1)} is not a valid 12-digit Aadhaar number`)
  return String(value).replace(/\s+/g, '').slice(-4)
}

const PAN = /^[A-Z]{5}\d{4}[A-Z]$/
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/
const CIN = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/
const IEC = /^[A-Z0-9]{10}$/
const MOBILE = /^[6-9]\d{9}$/

function pan(value, label, required) {
  const raw = text(value, 10).toUpperCase()
  if (!raw) {
    if (required) fail(`Enter ${label}`)
    return ''
  }
  if (!PAN.test(raw)) fail(`${label[0].toUpperCase()}${label.slice(1)} must look like ABCDE1234F`)
  return raw
}

function phone(value, label, required) {
  const raw = String(value ?? '').replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, '')
  if (!raw) {
    if (required) fail(`Enter ${label}`)
    return ''
  }
  if (!MOBILE.test(raw)) fail(`${label[0].toUpperCase()}${label.slice(1)} must be a 10-digit mobile number`)
  return raw
}

function price(value, label) {
  return number(value, label, { min: 0, max: 100000 })
}

// ------------------------------------------------------------------ sections
function beekeepingSection(input = {}) {
  const colonies = number(input.colonies, 'the number of bee colonies', { min: 10, max: 1000000, integer: true, required: true })
  const fpoMember = yes(input.fpo?.member)
  const land = input.land || {}
  const migration = input.migration || {}
  const landType = choice(LAND_TYPES, land.type, 'the land holding type', true)
  const from = choice(MONTHS, migration.from, 'the first migration month')
  const to = choice(MONTHS, migration.to, 'the last migration month')
  if ((from && !to) || (!from && to)) fail('Give both the first and the last migration month, or neither')

  const training = (Array.isArray(input.training) ? input.training : []).slice(0, 10).map((item) => ({
    name: choice(TRAINING_NAMES, item?.name, 'the training programme', true),
    organisedBy: choice(TRAINING_ORGANISERS, item?.organisedBy, 'who organised the training', true),
  }))

  const planIncrease = yes(input.planIncrease)
  if (planIncrease && text(input.planText, 400).length < 5) fail('Describe your plan to increase the number of colonies')

  return {
    colonies,
    species: choices(BEE_SPECIES, input.species, 'the bee species', { required: true }),
    experienceYears: number(input.experienceYears, 'the years of beekeeping experience', { min: 0, max: 80, required: true }),
    planIncrease,
    planText: planIncrease ? text(input.planText, 400) : '',
    fpo: fpoMember
      ? { member: true, name: text(input.fpo?.name, 120), regNo: text(input.fpo?.regNo, 60), contact: phone(input.fpo?.contact, 'the FPO / cooperative contact number', false) }
      : { member: false },
    land: { type: landType, ...(landType === 'Landless' ? {} : { state: choice(Object.keys(REGIONS), land.state, 'the land state'), district: text(land.district, 80) }) },
    migration: from ? { from, to, mainCrop: text(migration.mainCrop, 120) } : null,
    training,
  }
}

function productionSection(input = {}) {
  const other = {}
  for (const key of Object.keys(OTHER_PRODUCTS)) {
    const item = input.other?.[key] || {}
    const produced = number(item.produced, `${OTHER_PRODUCTS[key].label} produced`, { min: 0, max: 1e7 })
    const sold = number(item.sold, `${OTHER_PRODUCTS[key].label} sold`, { min: 0, max: 1e7 })
    const unitPrice = price(item.price, `${OTHER_PRODUCTS[key].label} price`)
    if (produced || sold || unitPrice) other[key] = { produced: produced || 0, sold: sold || 0, price: unitPrice || 0 }
  }

  const produced = number(input.honeyProducedKg, "last year's honey production (kg)", { min: 0, max: 1e7, required: true })
  const sold = number(input.honeySoldKg, "last year's honey sold (kg)", { min: 0, max: 1e7 }) || 0
  if (sold > produced) fail('Honey sold cannot be more than honey produced')

  return {
    honeyProducedKg: produced,
    honeySoldKg: sold,
    avgPriceKg: price(input.avgPriceKg, 'the average price per kg') || 0,
    soldTo: choices(SOLD_TO, input.soldTo, 'who the honey was sold to'),
    coloniesMultiplied: number(input.coloniesMultiplied, 'colonies multiplied', { min: 0, max: 1e6, integer: true }) || 0,
    coloniesSold: number(input.coloniesSold, 'colonies sold', { min: 0, max: 1e6, integer: true }) || 0,
    avgPriceColony: price(input.avgPriceColony, 'the average price per colony') || 0,
    hivesManufactured: number(input.hivesManufactured, 'beehives manufactured', { min: 0, max: 1e6, integer: true }) || 0,
    hivesSold: number(input.hivesSold, 'beehives sold', { min: 0, max: 1e6, integer: true }) || 0,
    avgPriceHive: price(input.avgPriceHive, 'the average price per beehive') || 0,
    other,
  }
}

function qualitySection(input = {}) {
  const medicines = yes(input.medicinesUsed)
  const antibiotics = yes(input.antibioticsUsed)
  if (medicines && text(input.medicinesDetails, 300).length < 3) fail('Say which medicines or chemicals were used')
  if (antibiotics && text(input.antibioticDetails, 300).length < 3) fail('Say which antibiotics were used')
  if (antibiotics && isBlank(input.professionalSupervision)) fail('Say whether the antibiotics were used under professional supervision')

  const containers = input.containers || {}
  return {
    medicinesUsed: medicines,
    medicinesDetails: medicines ? text(input.medicinesDetails, 300) : '',
    antibioticsUsed: antibiotics,
    antibioticDetails: antibiotics ? text(input.antibioticDetails, 300) : '',
    professionalSupervision: antibiotics ? yes(input.professionalSupervision) : null,
    antibioticDosage: antibiotics ? text(input.antibioticDosage, 120) : '',
    supplier: text(input.supplier, 200),
    withdrawalPeriod: text(input.withdrawalPeriod, 200),
    recordsMaintained: yes(input.recordsMaintained),
    purchaseBillsAvailable: yes(input.purchaseBillsAvailable),
    qualityEquipment: yes(input.qualityEquipment),
    containers: {
      count: number(containers.count, 'the number of honey containers', { min: 0, max: 100000, integer: true }) || 0,
      capacityKg: number(containers.capacityKg, 'the container capacity (kg)', { min: 0, max: 100000 }) || 0,
      type: choice(CONTAINER_TYPES, containers.type, 'the container type'),
    },
  }
}

function tradeSection(input = {}) {
  const states = choices(SOURCING_STATES, input.sourcingStates, 'the states you buy honey from', { required: true })
  const iec = text(input.iec, 10).toUpperCase()
  if (iec && !IEC.test(iec)) fail('Import Export Code must be 10 letters / digits')
  const warehouse = text(input.warehouseAddress, 240)
  if (warehouse.length < 10) fail('Enter the warehouse / godown address')

  return {
    businessType: choice(BUSINESS_TYPES, input.businessType, 'the business type', true),
    tradeLicenceNo: (() => { const value = text(input.tradeLicenceNo, 60); if (value.length < 3) fail('Enter the trade licence number'); return value })(),
    iec,
    apedaNo: text(input.apedaNo, 40),
    fssaiCategory: text(input.fssaiCategory, 60),
    storageCapacityKg: number(input.storageCapacityKg, 'the storage capacity (kg)', { min: 100, max: 1e8, required: true }),
    monthlyPurchaseKg: number(input.monthlyPurchaseKg, 'the monthly purchase capacity (kg)', { min: 50, max: 1e8, required: true }),
    warehouseAddress: warehouse,
    sourcingStates: states,
    honeyTypes: [...new Set((Array.isArray(input.honeyTypes) ? input.honeyTypes : []).map((item) => text(item, 60)).filter(Boolean))].slice(0, 20),
    brandName: text(input.brandName, 80),
    packagingTypes: choices(PACKAGING_TYPES, input.packagingTypes, 'the packaging types'),
    preferredSellers: text(input.preferredSellers, 300),
  }
}

// ------------------------------------------------------------------ the profile
// `account` carries what the registration form already validates elsewhere (name, GSTIN, ...). `previous` is the
// saved profile when one is being edited: Aadhaar and bank account numbers left blank then stay as they were.
export function buildProfile(categoryKey, input = {}, account = {}, previous = null) {
  const category = CATEGORIES[categoryKey]
  if (!category) fail('Choose how you are registering')

  const applicant = input.applicant || {}
  const authorised = input.authorised || {}
  const entity = input.entity || {}
  const nominee = input.nominee || {}
  const bank = input.bank || {}
  const business = input.business || {}
  const individual = categoryKey === 'INDIVIDUAL'
  const proprietor = categoryKey === 'WHOLESALER' && text(entity.kind, 60) === 'Proprietorship'

  const columns = {
    applicant_category: categoryKey,
    applicant_name: text(account.name, 120),
    father_husband_name: text(applicant.fatherHusbandName, 120),
    dob: isoDate(applicant.dob, 'the date of birth', { required: individual, minAge: 18, maxAge: 100, notFuture: true }),
    gender: choice(GENDERS, applicant.gender, 'the gender', individual),
    education: choice(EDUCATION, applicant.education, 'the educational qualification', individual),
    social_category: choice(SOCIAL_CATEGORIES, applicant.socialCategory, 'the social category'),
    aadhaar_last4: '',
    pan: pan(applicant.pan, 'the PAN', !individual),
    alt_phone: phone(applicant.altPhone, 'the alternate mobile number', false),
  }

  if (individual && columns.father_husband_name.length < 2) fail("Enter the father's / husband's name")

  if (individual || proprietor) {
    columns.aadhaar_last4 = aadhaarLast4(applicant.aadhaar, 'the Aadhaar number', true, previous?.applicant?.aadhaarLast4)
  }

  if (category.entity) {
    columns.entity_kind = choice(category.entityKinds, entity.kind, 'the type of organisation', true)
    const registrationNo = text(entity.registrationNo, 60)
    if (!proprietor && registrationNo.length < 3) fail(`Enter the ${categoryKey === 'COMPANY' ? 'registration' : 'registration / licence'} number of the ${category.label.toLowerCase()}`)
    columns.entity_registration_no = registrationNo
    columns.entity_registration_date = isoDate(entity.registrationDate, 'the date of registration', { required: !proprietor, notFuture: true })

    if (categoryKey === 'COMPANY' || (categoryKey === 'WHOLESALER' && /company|LLP/i.test(columns.entity_kind))) {
      const cin = text(entity.cin, 21).toUpperCase()
      if (categoryKey === 'COMPANY' && !CIN.test(cin)) fail('Enter the 21-character Corporate Identification Number (CIN)')
      if (cin && !CIN.test(cin)) fail('The Corporate Identification Number (CIN) is not valid')
      columns.cin = cin
    }

    if (categoryKey === 'SOCIETY') {
      columns.members_count = number(entity.membersCount, 'the number of members', { min: 2, max: 1e6, integer: true, required: true })
    }

    if (!proprietor) {
      columns.authorised_name = text(authorised.name, 120)
      columns.authorised_designation = text(authorised.designation, 80)
      if (columns.authorised_name.length < 2) fail('Enter the name of the head / secretary / authorised person')
      if (columns.authorised_designation.length < 2) fail('Enter the designation of the authorised person (Head, Secretary, President, Director ...)')
      columns.authorised_aadhaar_last4 = aadhaarLast4(authorised.aadhaar, "the authorised person's Aadhaar number", true, previous?.authorised?.aadhaarLast4)
    }
  }

  if (!isBlank(nominee.name)) {
    columns.nominee_name = text(nominee.name, 120)
    columns.nominee_dob = isoDate(nominee.dob, "the nominee's date of birth", { required: true, notFuture: true })
    columns.nominee_relation = choice(NOMINEE_RELATIONS, nominee.relation, "the nominee's relationship", true)
  }

  if (!isBlank(bank.accountNumber) || !isBlank(bank.ifsc) || !isBlank(bank.bankName)) {
    const accountNo = String(bank.accountNumber ?? '').replace(/\s+/g, '')
    const keptLast4 = !accountNo && previous?.bank?.accountLast4
    const ifsc = text(bank.ifsc, 11).toUpperCase()
    if (!keptLast4 && !/^\d{9,18}$/.test(accountNo)) fail('The bank account number must be 9 to 18 digits')
    if (!IFSC.test(ifsc)) fail('The IFSC code must look like SBIN0001234')
    columns.bank_holder = text(bank.holderName, 120) || text(account.name, 120)
    columns.bank_name = text(bank.bankName, 100)
    if (columns.bank_name.length < 2) fail('Enter the bank name')
    columns.ifsc = ifsc
    columns.account_last4 = keptLast4 || accountNo.slice(-4)
  }

  if (!isBlank(business.address) || !isBlank(business.district)) {
    columns.business_state = choice(Object.keys(REGIONS), business.state, 'the business activity state')
    columns.business_district = text(business.district, 80)
    columns.business_address = text(business.address, 240)
  }

  const details = {}
  if (category.producer) {
    details.beekeeping = beekeepingSection(input.beekeeping)
    details.production = productionSection(input.production)
    details.quality = qualitySection(input.quality)
  } else {
    details.trade = tradeSection(input.trade)
  }

  return { columns, details }
}

// The fields an officer, the applicant and the wholesaler workspace read back.
export function publicProfile(row) {
  if (!row) return null
  const details = (() => { try { return JSON.parse(row.details_json || '{}') } catch { return {} } })()
  return {
    category: row.applicant_category,
    applicant: {
      name: row.applicant_name, fatherHusbandName: row.father_husband_name, dob: row.dob, gender: row.gender, education: row.education,
      socialCategory: row.social_category, aadhaarLast4: row.aadhaar_last4, pan: row.pan, altPhone: row.alt_phone,
    },
    authorised: row.authorised_name ? { name: row.authorised_name, designation: row.authorised_designation, aadhaarLast4: row.authorised_aadhaar_last4 } : null,
    entity: row.entity_kind ? {
      kind: row.entity_kind, registrationNo: row.entity_registration_no, registrationDate: row.entity_registration_date, cin: row.cin, membersCount: row.members_count,
    } : null,
    nominee: row.nominee_name ? { name: row.nominee_name, dob: row.nominee_dob, relation: row.nominee_relation } : null,
    bank: row.ifsc ? { holderName: row.bank_holder, bankName: row.bank_name, ifsc: row.ifsc, accountLast4: row.account_last4 } : null,
    business: row.business_address ? { state: row.business_state, district: row.business_district, address: row.business_address } : null,
    ...details,
    sample: Boolean(row.is_sample),
    updatedAt: row.updated_at,
  }
}
