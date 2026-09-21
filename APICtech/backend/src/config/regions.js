// States and KVIC regions used for registration and officer jurisdiction.
// A regional officer is bound to one state + region, a state officer to one state.
export const REGIONS = {
  'Tamil Nadu': ['Madurai', 'Coimbatore', 'Chennai', 'Salem'],
  Kerala: ['Thiruvananthapuram', 'Kochi', 'Kozhikode'],
  Karnataka: ['Bengaluru', 'Mysuru', 'Belagavi'],
  Maharashtra: ['Pune', 'Nashik', 'Nagpur'],
  'Uttar Pradesh': ['Lucknow', 'Varanasi', 'Agra'],
  Punjab: ['Ludhiana', 'Amritsar'],
  Uttarakhand: ['Dehradun', 'Haldwani'],
  'Himachal Pradesh': ['Shimla', 'Kullu'],
}

// Demo login for a region's officer, e.g. "Thiruvananthapuram" -> region.thiruvananthapuram
export function regionalUsername(region) {
  return `region.${region.toLowerCase().replace(/\s+/g, '-')}`
}

// Demo login for a state's officer: Tamil Nadu keeps state.tn, the others are state.<name>.
export function stateUsername(state) {
  return state === 'Tamil Nadu' ? 'state.tn' : `state.${state.toLowerCase().replace(/\s+/g, '-')}`
}

export function isValidJurisdiction(state, region) {
  return Boolean(REGIONS[state]) && (!region || REGIONS[state].includes(region))
}

export const ORGANIZATION_TYPES = {
  KVIC_BEEKEEPER: 'Beekeeper registered with KVIC (Honey Mission)',
  ORG_BEEKEEPER: 'Beekeeper registered through another organisation (SHG / FPO / NGO)',
  LOCAL_STARTUP: 'Local honey startup / food business',
}
