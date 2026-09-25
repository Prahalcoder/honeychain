// Registration categories and the choices behind every field, modelled on the National Bee Board's Madhukranti
// portal (madhukranti.in): Individual Beekeeper, Firm, Society, Company and Wholesalers / Traders / Packers, with
// the same applicant, colony, production, training, land, disease-management and document sections.
// Equipment manufacturers register on Madhukranti too but never handle honey, so they are not offered here.
export const CATEGORIES = {
  INDIVIDUAL: {
    label: 'Individual beekeeper',
    hint: 'A person who keeps at least 10 honey bee colonies of their own.',
    role: 'BEEKEEPER', producer: true, entity: false,
  },
  FIRM: {
    label: 'Firm',
    hint: 'A proprietorship or partnership that keeps bees (at least 10 colonies).',
    role: 'BEEKEEPER', producer: true, entity: true, entityKinds: ['Proprietorship', 'Partnership', 'LLP'],
  },
  SOCIETY: {
    label: 'Society / cooperative',
    hint: 'A beekeeping & honey society or cooperative registered under the Societies Registration Act or a Cooperative Societies Act.',
    role: 'BEEKEEPER', producer: true, entity: true,
    entityKinds: ['Beekeeping & honey society', 'Cooperative society', 'Self-help group (SHG)', 'NGO / trust'],
  },
  COMPANY: {
    label: 'Company (incl. FPO / FPC)',
    hint: 'A company incorporated under the Companies Act, including a Farmer Producer Company / Organisation.',
    role: 'BEEKEEPER', producer: true, entity: true,
    entityKinds: ['Private limited company', 'Public limited company', 'Farmer Producer Company (FPC)', 'Farmer Producer Organisation (FPO)', 'Section 8 company'],
  },
  WHOLESALER: {
    label: 'Wholesaler / trader / packer',
    hint: 'Buys honey in bulk from registered beekeepers to pack, process, export or resell. Needs GST and FSSAI.',
    role: 'WHOLESALER', producer: false, entity: true,
    entityKinds: ['Proprietorship', 'Partnership', 'LLP', 'Private limited company', 'Public limited company', 'Cooperative / FPO', 'Other'],
  },
}

// organizations.organization_type for a category (how the applicant is registered with KVIC / NBB).
export const TRADER_TYPE = 'TRADER'

export const GENDERS = ['Male', 'Female', 'Transgender']
export const EDUCATION = ['Illiterate', '10th', '12th', 'Graduate', 'Post Graduate']
export const SOCIAL_CATEGORIES = ['General', 'SC', 'ST']
export const BEE_SPECIES = ['Apis cerana', 'Apis mellifera', 'Trigona (stingless bee)']
export const SOLD_TO = ['Aggregator', 'Processing unit', 'Packaging / marketing company', 'Exporter', 'Trader']
export const LAND_TYPES = ['Self owned', 'Leased', 'Landless']
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const NOMINEE_RELATIONS = ['Father', 'Mother', 'Spouse', 'Son', 'Daughter', 'Brother', 'Sister']
export const CONTAINER_TYPES = ['Food grade plastic', 'Stainless steel', 'Glass']
export const TRAINING_NAMES = [
  'Basic beekeeping training', 'Advanced beekeeping', 'Queen rearing', 'Migratory beekeeping', 'Bee disease and pest management',
  'Honey extraction, processing and quality', 'Bee products (wax, propolis, pollen, royal jelly)', 'Integrated apiary management', 'Other',
]
export const TRAINING_ORGANISERS = [
  'National Bee Board (NBB)', 'KVIC / State KVIB', 'State Horticulture Department', 'ICAR / Krishi Vigyan Kendra (KVK)',
  'National Horticulture Board (NHB)', 'State Agricultural University', 'NGO / FPO / Cooperative', 'Other',
]
export const OTHER_PRODUCTS = {
  pollen: { label: 'Bee pollen', unit: 'kg' },
  propolis: { label: 'Propolis', unit: 'kg' },
  wax: { label: 'Bee wax', unit: 'kg' },
  royalJelly: { label: 'Royal jelly', unit: 'kg' },
  venom: { label: 'Bee venom', unit: 'gram' },
  combHoney: { label: 'Comb honey', unit: 'kg' },
}

// Wholesaler / trader details.
export const BUSINESS_TYPES = ['Aggregator', 'Processing unit', 'Packaging / marketing company', 'Exporter', 'Trader / distributor', 'Retail chain']
export const PACKAGING_TYPES = ['Glass jars', 'PET / food grade plastic jars', 'Squeeze bottles', 'Sachets', 'Bulk drums / buckets', 'Comb honey frames']
export const SOURCING_STATES = ['Tamil Nadu', 'Kerala', 'Karnataka', 'Maharashtra', 'Uttar Pradesh', 'Punjab', 'Uttarakhand', 'Himachal Pradesh']

// Registration charge by number of colonies (National Bee Board guidelines, clause xviii), plus the portal's
// 5-year SMS charge and convenience fee. Shown as an estimate: this prototype does not collect payment.
export const FEE_SLABS = [
  { from: 10, to: 100, fee: 250 },
  { from: 101, to: 250, fee: 500 },
  { from: 251, to: 500, fee: 1000 },
  { from: 501, to: 1000, fee: 2000 },
  { from: 1001, to: 2000, fee: 10000 },
  { from: 2001, to: 5000, fee: 25000 },
  { from: 5001, to: 10000, fee: 100000 },
  { from: 10001, to: null, fee: 200000 },
]
export const SMS_CHARGE = 200
export const CONVENIENCE_FEE = 20

export function registrationFee(colonies) {
  const count = Number(colonies)
  if (!Number.isFinite(count) || count < 10) return null
  const slab = FEE_SLABS.find((item) => count >= item.from && (item.to === null || count <= item.to))
  return { slab, registration: slab.fee, sms: SMS_CHARGE, convenience: CONVENIENCE_FEE, total: slab.fee + SMS_CHARGE + CONVENIENCE_FEE }
}

// Every document a company can have on file. All accept a PDF or a JPEG / PNG picture.
export const DOC_TYPES = {
  BEE_COLONY_PHOTO: 'Photo of the bee colonies with the beekeeper',
  APPLICANT_PHOTO: 'Recent passport-size photograph',
  ID_PROOF: 'Identity proof (PAN / Aadhaar / passport / voter ID / driving licence)',
  PAN_CARD: 'PAN card of the firm / society / company',
  FSSAI: 'FSSAI licence / registration',
  GSTIN: 'GST registration certificate',
  REG_CERTIFICATE: 'Registration certificate (firm / society / trade)',
  RESOLUTION: 'Resolution authorising the applicant',
  BYE_LAWS: 'Bye-laws of the society',
  INCORPORATION_CERT: 'Certificate of incorporation',
  MOA: 'Memorandum of Association',
  TRADE_LICENCE: 'Trade licence / shop and establishment certificate',
  TRAINING_CERT: 'Beekeeping training certificate',
  OTHER: 'Other document',
}

const need = (type, required = true) => ({ type, required })

export const DOCUMENTS_BY_CATEGORY = {
  INDIVIDUAL: [need('BEE_COLONY_PHOTO'), need('ID_PROOF'), need('FSSAI'), need('APPLICANT_PHOTO', false), need('GSTIN', false), need('TRAINING_CERT', false)],
  FIRM: [need('BEE_COLONY_PHOTO'), need('ID_PROOF'), need('PAN_CARD'), need('REG_CERTIFICATE'), need('FSSAI'), need('GSTIN', false), need('TRAINING_CERT', false)],
  SOCIETY: [need('BEE_COLONY_PHOTO'), need('ID_PROOF'), need('RESOLUTION'), need('BYE_LAWS'), need('REG_CERTIFICATE'), need('FSSAI'), need('PAN_CARD', false), need('GSTIN', false)],
  COMPANY: [need('BEE_COLONY_PHOTO'), need('ID_PROOF'), need('PAN_CARD'), need('INCORPORATION_CERT'), need('MOA'), need('RESOLUTION'), need('FSSAI'), need('GSTIN', false)],
  WHOLESALER: [need('ID_PROOF'), need('PAN_CARD'), need('GSTIN'), need('FSSAI'), need('TRADE_LICENCE'), need('REG_CERTIFICATE', false), need('RESOLUTION', false)],
}

export function documentsFor(category) {
  const list = DOCUMENTS_BY_CATEGORY[category] || DOCUMENTS_BY_CATEGORY.INDIVIDUAL
  return [...list, need('OTHER', false)].map((item) => ({ ...item, label: DOC_TYPES[item.type] }))
}
