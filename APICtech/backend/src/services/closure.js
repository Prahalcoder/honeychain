import crypto from 'node:crypto'

import db from '../database/database.js'
import { recordAudit } from './audit.js'
import { sealPendingBlock } from './blockchain.js'
import { archiveCompanyDb } from './companyDb.js'
import { parseJson } from './batches.js'
import { appendTraceabilityEvent } from './traceabilityLog.js'

// Formal closure (deregistration) of an organisation. The checklist follows the
// exits an Indian honey business normally has to complete. It is guidance for the
// officer: the references are the acknowledgement numbers the keeper received
// from each authority, and the officer confirms them. Statutory sources:
//  - FSSAI: surrender of licence/registration on the FoSCoS portal, approved by
//    the licensing authority.
//  - GST: cancellation in Form GST REG-16 and the final return GSTR-10 within
//    three months of the cancellation date (CGST Act, 2017).
//  - Madhukranti (National Bee Board, NBHM) / KVIC Honey Mission / parent society:
//    withdrawal of the beekeeper registration.
export const CLOSURE_ITEMS = [
  { id: 'stock', label: 'Honey stock cleared', detail: 'Remaining honey has been sold, transferred with records or disposed of.', reference: 'optional' },
  { id: 'dues', label: 'Buyer payments and dues settled', detail: 'Invoices, supplier dues and staff dues are cleared (declared by the keeper).', reference: 'none' },
  { id: 'fssai', label: 'FSSAI licence / registration surrendered', detail: 'Surrender filed on the FoSCoS portal (foscos.fssai.gov.in) and accepted by the licensing authority.', reference: 'required', referenceLabel: 'FoSCoS surrender application / acknowledgement no.' },
  { id: 'gst', label: 'GST registration cancelled, GSTR-10 filed', detail: 'Cancellation applied in Form GST REG-16; final return GSTR-10 due within 3 months of cancellation. Not applicable if the business was never GST registered.', reference: 'required', referenceLabel: 'REG-16 ARN / GSTR-10 ARN', appliesWhen: 'gstin' },
  { id: 'registration', label: 'KVIC / Madhukranti / parent organisation withdrawal', detail: 'Beekeeper registration withdrawn with the issuing body (KVIC Honey Mission, National Bee Board Madhukranti portal, or the FPO / SHG / NGO).', reference: 'optional', referenceLabel: 'Letter or acknowledgement no.' },
  { id: 'schemes', label: 'No outstanding government scheme dues', detail: 'Loans, subsidies or assets under schemes such as PMEGP or the Honey Mission (bee boxes, toolkits) are cleared or returned.', reference: 'optional', referenceLabel: 'No-dues certificate no.' },
  { id: 'records', label: 'Records retention undertaking', detail: 'The keeper will retain accounts and tax records for the statutory period. Honey Chain keeps the blockchain records permanently.', reference: 'none' },
]

export function applicableItems(organization) {
  return CLOSURE_ITEMS.filter((item) => item.appliesWhen !== 'gstin' || organization.gstin)
}

export async function getOpenClosure(orgId) {
  return await db.prepare("SELECT * FROM closure_requests WHERE org_id = ? AND status = 'REQUESTED' ORDER BY id DESC LIMIT 1").get(orgId)
}

export async function readiness(organization) {
  const labs = (await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM lab_requests WHERE org_id = ? AND status = 'REQUESTED') +
      (SELECT COUNT(*) FROM lab_reviews WHERE org_id = ? AND status = 'PENDING') AS open
  `).get(organization.id, organization.id)).open

  const balances = await db.prepare(`
    SELECT b.quantity_kg, (SELECT quantity_kg FROM custody_balances c WHERE c.batch_id = b.id AND c.party_type = 'APICTECH') AS held
    FROM batches b WHERE b.org_id = ?
  `).all(organization.id)

  return {
    openLabWork: labs,
    stockHeldKg: Math.round(balances.reduce((sum, row) => sum + (row.held ?? row.quantity_kg), 0) * 100) / 100,
  }
}

export function closureView(row) {
  return {
    id: row.id,
    status: row.status,
    reason: row.reason,
    initiatedBy: row.initiated_by_role,
    declarations: parseJson(row.declarations_json) || {},
    checklist: parseJson(row.checklist_json) || {},
    completionNote: row.completion_note,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }
}

export class ClosureError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

// Validates the officer's checklist and closes the organisation.
export async function completeClosure({ closure, organization, officer, items = {}, note }) {
  const readyState = await readiness(organization)

  if (readyState.openLabWork > 0) {
    throw new ClosureError('Open laboratory requests or reviews must be finished first', 409)
  }

  const checklist = {}
  for (const item of applicableItems(organization)) {
    const entry = items[item.id] || {}
    const reference = String(entry.reference || '').trim().slice(0, 80)

    if (!entry.confirmed) throw new ClosureError(`Confirm this formality first: ${item.label}`)
    if (item.reference === 'required' && !reference) {
      throw new ClosureError(`Enter the ${item.referenceLabel || 'reference'} for: ${item.label}`)
    }

    checklist[item.id] = { confirmed: true, reference: reference || null }
  }

  if (String(note || '').trim().length < 5) throw new ClosureError('Add a closing note (at least 5 characters)')

  const now = new Date().toISOString()
  const archived = { file: null }

  await db.transaction(async () => {
    await db.prepare(`
      UPDATE closure_requests
      SET status = 'COMPLETED', checklist_json = ?, completion_note = ?, completed_by = ?, completed_at = ?
      WHERE id = ?
    `).run(JSON.stringify(checklist), String(note).trim(), officer.id, now, closure.id)

    await db.prepare(`
      UPDATE organizations SET status = 'CLOSED', reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?
    `).run(officer.id, now, String(note).trim(), organization.id)

    // The owner can no longer sign in; the records stay.
    await db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(organization.owner_user_id)

    await appendTraceabilityEvent({
      entityType: 'ORGANIZATION',
      entityId: organization.organization_code,
      eventType: 'ORGANIZATION_CLOSED',
      payload: {
        organizationCode: organization.organization_code,
        closureId: closure.id,
        checklistHash: crypto.createHash('sha256').update(JSON.stringify(checklist)).digest('hex'),
        closedByRole: officer.role,
        closedByUserId: officer.id,
      },
      createdBy: officer.id,
    })
    await sealPendingBlock()

    await recordAudit(officer, 'ORG_CLOSURE', 'ORGANIZATION', organization.organization_code, {
      orgName: organization.legal_name,
      closureId: closure.id,
      note: String(note).trim(),
    })
  })()

  archived.file = await archiveCompanyDb(organization.organization_code)
  if (archived.file) {
    await db.prepare('UPDATE organizations SET private_db_file = ? WHERE id = ?').run(archived.file, organization.id)
  }

  return checklist
}
