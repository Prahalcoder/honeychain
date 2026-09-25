// Special honey of each state, from the "Honey details" sheet: the honey types the sheet links to a region, and the
// SFAC "Nature's Gold" catalogue listings (a seller, its place and a price for a pack). Where the sheet has no honey
// for a state (Tamil Nadu, Karnataka) a plain multi-floral honey is used and marked as a placeholder until the
// regional list arrives. Prices are per pack as listed by SFAC; where the sheet gives none, `demoPrice` is a round
// number used only to fill the demo shop. Nothing here is a fixed or official price.
export const BASE_HONEY_TYPES = ['Natural Honey', 'Forest Honey', 'Wildflower Honey', 'Floral Honey']

// packGrams: the pack size the reference price is for.
export const HONEY_BY_STATE = {
  'Himachal Pradesh': [
    { type: 'Apple honey', note: 'Apple orchards of the hills (sheet: J&K, Ladakh, Himachal Pradesh)', packGrams: 500, demoPrice: 380 },
    { type: 'Kala jeera honey', note: 'Unifloral, Upper Valley FPC, Kullu (SFAC: Rs 800 per kg)', packGrams: 500, price: 400, source: 'SFAC' },
  ],
  Kerala: [
    { type: 'Coconut honey', note: 'Coconut groves of Kerala (sheet)', packGrams: 500, demoPrice: 350 },
  ],
  Maharashtra: [
    { type: 'Multi-floral honey', note: 'Mixed flowers of Maharashtra (sheet)', packGrams: 500, demoPrice: 300 },
  ],
  'Uttar Pradesh': [
    { type: 'Litchi honey', note: 'Unifloral, Mahatma Vidur FPC, Bijnor (SFAC: Rs 230 per 500 g)', packGrams: 500, price: 230, source: 'SFAC' },
  ],
  Uttarakhand: [
    { type: 'Multi-floral honey', note: 'Lohaghat Hill FPC, Champawat (SFAC: Rs 449 per 500 g)', packGrams: 500, price: 449, source: 'SFAC' },
  ],
  Punjab: [
    { type: 'Raw unfiltered honey', note: 'Nirbhai Fed FPC, Sarmala (SFAC: Rs 160 per 500 g)', packGrams: 500, price: 160, source: 'SFAC' },
  ],
  'Tamil Nadu': [
    { type: 'Multi-floral honey', note: 'Placeholder until the Tamil Nadu list is added', packGrams: 500, demoPrice: 300, placeholder: true },
  ],
  Karnataka: [
    { type: 'Multi-floral honey', note: 'Placeholder until the Karnataka list is added', packGrams: 500, demoPrice: 300, placeholder: true },
  ],
}

// All special honey types (they are accepted when a harvest is recorded).
export const CATALOGUE_TYPES = [...new Set(Object.values(HONEY_BY_STATE).flat().map((item) => item.type))]
export const ALL_HONEY_TYPES = [...new Set([...BASE_HONEY_TYPES, ...CATALOGUE_TYPES, 'Other'])]

export const specialtiesFor = (state) => HONEY_BY_STATE[state] || []

// The honey types a keeper of this state is offered first.
export function honeyTypesFor(state) {
  const own = specialtiesFor(state).map((item) => item.type)
  return [...new Set([...own, ...BASE_HONEY_TYPES, 'Other'])]
}

// The starting minimum price per kg of a honey type (set by the KVIC head office afterwards): the SFAC price of the
// sheet where it has one, else a demo figure. Where a type is listed for several states the lowest is used.
const OTHER_MIN_PER_KG = 400
export function seedMinimumPerKg(type) {
  const listed = Object.values(HONEY_BY_STATE).flat().filter((item) => item.type === type)
  if (listed.length === 0) return OTHER_MIN_PER_KG
  return Math.round(Math.min(...listed.map((item) => ((item.price ?? item.demoPrice ?? 300) * 1000) / (item.packGrams || 500))))
}

// The reference price of one jar (scaled to the jar size, rounded to a whole rupee) for a special honey.
export function referencePrice(item, jarGrams = 500) {
  const per500 = item.price ?? item.demoPrice ?? 300
  return Math.max(1, Math.round((per500 * jarGrams) / (item.packGrams || 500)))
}
