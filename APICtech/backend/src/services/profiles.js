import db from '../database/database.js'
import { publicProfile } from './registrationProfile.js'

const COLUMNS = [
  'applicant_category', 'applicant_name', 'father_husband_name', 'dob', 'gender', 'education', 'social_category', 'aadhaar_last4', 'pan',
  'alt_phone', 'entity_kind', 'entity_registration_no', 'entity_registration_date', 'cin', 'members_count', 'authorised_name',
  'authorised_designation', 'authorised_aadhaar_last4', 'nominee_name', 'nominee_dob', 'nominee_relation', 'bank_holder', 'bank_name', 'ifsc',
  'account_last4', 'business_state', 'business_district', 'business_address',
]

// Writes (or replaces) a company's registration profile. `sample` marks details made up for a company that
// registered before these fields existed, so an officer can tell them from what the keeper really declared.
export async function saveProfile(orgId, { columns, details }, { sample = false } = {}) {
  const values = COLUMNS.map((column) => columns[column] ?? null)
  await db.prepare(`
    INSERT INTO organization_profiles (org_id, ${COLUMNS.join(', ')}, details_json, is_sample, updated_at)
    VALUES (?, ${COLUMNS.map(() => '?').join(', ')}, ?, ?, ?)
    ON CONFLICT (org_id) DO UPDATE SET ${COLUMNS.map((column) => `${column} = excluded.${column}`).join(', ')},
      details_json = excluded.details_json, is_sample = excluded.is_sample, updated_at = excluded.updated_at
  `).run(orgId, ...values, JSON.stringify(details || {}), sample ? 1 : 0, new Date().toISOString())
}

export async function getProfile(orgId) {
  return publicProfile(await db.prepare('SELECT * FROM organization_profiles WHERE org_id = ?').get(orgId))
}
