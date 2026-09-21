export const ROLES = {
  BEEKEEPER: 'BEEKEEPER',
  REGIONAL: 'REGIONAL_OFFICER',
  STATE: 'STATE_OFFICER',
  HEAD: 'KVIC_HEAD',
}

export const OFFICER_ROLES = [ROLES.REGIONAL, ROLES.STATE, ROLES.HEAD]

// SQL fragment limiting organisations to an officer's jurisdiction.
// KVIC head sees everything, a state officer one state, a regional officer
// one region of one state.
export function orgScope(user, alias = 'o') {
  if (user.role === ROLES.HEAD) return { sql: '', params: [] }

  if (user.role === ROLES.STATE) {
    return { sql: ` AND ${alias}.state = ?`, params: [user.state] }
  }

  return {
    sql: ` AND ${alias}.state = ? AND ${alias}.region = ?`,
    params: [user.state, user.region],
  }
}

export function inScope(user, organization) {
  if (user.role === ROLES.HEAD) return true
  if (user.role === ROLES.STATE) return organization.state === user.state
  return organization.state === user.state && organization.region === user.region
}

// Monthly income is visible to state officers and the KVIC head only.
export function canSeeIncome(user) {
  return user.role === ROLES.STATE || user.role === ROLES.HEAD
}
