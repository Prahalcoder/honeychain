import db from '../database/database.js'
import { formatAddress } from '../config/sampleData.js'

// The KVIC offices: the central office, one per state and one per region. Their addresses are shown to
// keepers (their own regional and state office) and to officers (their own office and the directory).
export const officeView = (row) => (row ? {
  level: row.level, name: row.name, state: row.state || null, region: row.region || null,
  addressLine: row.address_line, locality: row.locality, district: row.district, pincode: row.pincode,
  address: formatAddress({ addressLine: row.address_line, locality: row.locality, district: row.district, state: row.state, pincode: row.pincode }),
  email: row.email, sample: Boolean(row.is_sample),
} : null)

export async function officeFor(level, state = '', region = '') {
  return officeView(await db.prepare('SELECT * FROM offices WHERE level = ? AND state = ? AND region = ?').get(level, state || '', region || ''))
}

// The offices a keeper answers to.
export async function officesForOrganization(org) {
  return {
    regional: await officeFor('REGIONAL', org.state, org.region),
    state: await officeFor('STATE', org.state),
    central: await officeFor('CENTRAL'),
  }
}

// The office an officer works from.
export async function officeOfOfficer(user) {
  if (user.role === 'REGIONAL_OFFICER') return await officeFor('REGIONAL', user.state, user.region)
  if (user.role === 'STATE_OFFICER') return await officeFor('STATE', user.state)
  if (user.role === 'KVIC_HEAD') return await officeFor('CENTRAL')
  return null
}

export async function allOffices() {
  const rows = await db.prepare("SELECT * FROM offices ORDER BY CASE level WHEN 'CENTRAL' THEN 0 WHEN 'STATE' THEN 1 ELSE 2 END, state, region").all()
  return rows.map(officeView)
}
