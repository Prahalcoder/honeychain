import db from '../database/database.js'
import { sealPendingBlock } from './blockchain.js'
import { parseJson } from './batches.js'
import { appendTraceabilityEvent } from './traceabilityLog.js'

// Inspections (audits). An officer schedules a visit with at least one day's
// notice, visits, then files a report: checklist ratings, grade and remarks.
// The chain records that an inspection happened and its grade; the detailed
// notes stay in the common database.

export const PURPOSES = {
  ROUTINE: 'Routine compliance inspection',
  COMPLAINT: 'Complaint or consumer report',
  LAB_FAILURE: 'Follow-up on a failed or doubtful lab result',
  LICENCE: 'Licence and registration verification',
  FOLLOW_UP: 'Follow-up on an earlier inspection',
}

export const CHECKLIST = [
  { id: 'licences', label: 'FSSAI licence and registration documents valid and displayed' },
  { id: 'apiary', label: 'Apiary and hive condition' },
  { id: 'extraction', label: 'Extraction and processing hygiene' },
  { id: 'storage', label: 'Honey storage and food-grade containers' },
  { id: 'records', label: 'Harvest, sales and batch records kept' },
  { id: 'packaging', label: 'Packaging and labelling (batch number, QR, FSSAI number)' },
  { id: 'stock', label: 'Physical stock matches the blockchain record' },
  { id: 'adulteration', label: 'No sign of adulteration (added sugar or syrup)' },
]

export const RATINGS = ['OK', 'MINOR', 'MAJOR', 'NA']
export const GRADES = { A: 'Excellent', B: 'Good', C: 'Needs improvement', D: 'Unsatisfactory' }
export const OUTCOMES = {
  NO_ACTION: 'No action needed',
  CORRECTIVE_ACTION: 'Corrective action required',
  RE_INSPECTION: 'Re-inspection required',
  CLOSURE_RECOMMENDED: 'Closure recommended',
}

export class InspectionError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && !Number.isNaN(Date.parse(value))
const isTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value))
const today = () => new Date().toLocaleDateString('en-CA')
const addDays = (days) => new Date(Date.now() + days * 86400000).toLocaleDateString('en-CA')
const text = (value, max) => String(value ?? '').trim().slice(0, max)

// A grade suggested from the checklist. The officer can choose another one.
export function suggestGrade(checklist) {
  const ratings = Object.values(checklist).map((entry) => entry.rating)
  const major = ratings.filter((rating) => rating === 'MAJOR').length
  const minor = ratings.filter((rating) => rating === 'MINOR').length

  if (major >= 2) return 'D'
  if (major === 1 || minor >= 3) return 'C'
  if (minor >= 1) return 'B'
  return 'A'
}

// Honey the blockchain holds for this organisation, to compare with the stock seen on site.
export async function chainStockKg(orgId) {
  const rows = await db.prepare(`
    SELECT b.quantity_kg, (SELECT quantity_kg FROM custody_balances c WHERE c.batch_id = b.id AND c.party_type = 'APICTECH') AS held
    FROM batches b WHERE b.org_id = ?
  `).all(orgId)

  return Math.round(rows.reduce((sum, row) => sum + (row.held ?? row.quantity_kg), 0) * 100) / 100
}

// Shape shown to officers (everything) and to the keeper (no internal note).
export function inspectionView(row, { forKeeper = false } = {}) {
  const done = row.status === 'COMPLETED'

  return {
    id: row.id,
    code: row.inspection_code,
    orgId: row.org_id,
    purpose: row.purpose,
    purposeLabel: PURPOSES[row.purpose] || row.purpose,
    scheduledDate: row.scheduled_date,
    scheduledTime: row.scheduled_time,
    instructions: row.instructions,
    status: row.status,
    noticeAt: row.notice_at,
    acknowledgedAt: row.acknowledged_at,
    cancelReason: row.cancel_reason,
    initiatedByRole: row.initiated_by_role,
    conductedOn: row.conducted_on,
    inspectorName: row.inspector_name,
    presentPerson: row.present_person,
    checklist: done ? parseJson(row.checklist_json) || {} : null,
    findings: done ? CHECKLIST.map((item) => ({ id: item.id, label: item.label, ...(parseJson(row.checklist_json) || {})[item.id] })) : [],
    physicalStockKg: row.physical_stock_kg,
    chainStockKg: row.chain_stock_kg,
    grade: row.grade,
    gradeLabel: GRADES[row.grade] || null,
    outcome: row.outcome,
    outcomeLabel: OUTCOMES[row.outcome] || null,
    remarks: row.remarks,
    correctiveActions: row.corrective_actions,
    correctiveDue: row.corrective_due,
    reportedAt: row.reported_at,
    closureNoticeAt: row.closure_notice_at,
    ...(forKeeper ? {} : { internalNote: row.internal_note, reportedBy: row.reported_by_name || null, initiatedBy: row.initiated_by_name || null }),
  }
}

const SELECT_BASE = `
  SELECT i.*, ib.name AS initiated_by_name, rb.name AS reported_by_name,
    o.legal_name AS org_name, o.organization_code AS org_code, o.state, o.region, o.status AS org_status
  FROM inspections i
  JOIN organizations o ON o.id = i.org_id
  LEFT JOIN users ib ON ib.id = i.initiated_by
  LEFT JOIN users rb ON rb.id = i.reported_by
`

export async function inspectionRows({ scope = { sql: '', params: [] }, status, orgId, id } = {}) {
  const conditions = []
  const params = [...scope.params]

  if (status && status !== 'ALL') { conditions.push('i.status = ?'); params.push(status) }
  if (orgId) { conditions.push('i.org_id = ?'); params.push(orgId) }
  if (id) { conditions.push('i.id = ?'); params.push(id) }

  return await db.prepare(`
    ${SELECT_BASE}
    WHERE 1 = 1 ${scope.sql} ${conditions.length ? `AND ${conditions.join(' AND ')}` : ''}
    ORDER BY (i.status = 'SCHEDULED') DESC, i.scheduled_date DESC, i.id DESC LIMIT 300
  `).all(...params)
}

export async function scheduleInspection({ organization, officer, date, time, purpose, instructions }) {
  if (!['APPROVED', 'SUSPENDED'].includes(organization.status)) {
    throw new InspectionError(`An organisation that is ${organization.status} cannot be scheduled for inspection`, 409)
  }
  if (!PURPOSES[purpose]) throw new InspectionError('Choose the purpose of the inspection')
  if (!isDate(date)) throw new InspectionError('Choose the inspection date')
  if (date < addDays(1)) throw new InspectionError('The keeper must get at least one day of notice: choose tomorrow or a later date')
  if (date > addDays(90)) throw new InspectionError('Choose a date within the next 90 days')
  if (time && !isTime(time)) throw new InspectionError('Time must look like 10:30')

  const open = await db.prepare("SELECT inspection_code FROM inspections WHERE org_id = ? AND status = 'SCHEDULED'").get(organization.id)
  if (open) throw new InspectionError(`${open.inspection_code} is already scheduled for this organisation. Cancel it or file its report first.`, 409)

  const now = new Date().toISOString()

  return await db.transaction(async () => {
    const id = (await db.prepare(`
      INSERT INTO inspections (org_id, initiated_by, initiated_by_role, purpose, scheduled_date, scheduled_time, instructions, notice_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(organization.id, officer.id, officer.role, purpose, date, time || null, text(instructions, 500) || null, now)).lastInsertRowid

    const code = `INSP-${date.slice(0, 4)}-${String(id).padStart(4, '0')}`
    await db.prepare('UPDATE inspections SET inspection_code = ? WHERE id = ?').run(code, id)

    await appendTraceabilityEvent({
      entityType: 'ORGANIZATION',
      entityId: organization.code,
      eventType: 'INSPECTION_SCHEDULED',
      payload: { inspectionCode: code, scheduledDate: date, purpose, scheduledBy: officer.role },
      createdBy: officer.id,
    })
    await sealPendingBlock()

    return { id, code }
  })()
}

export async function cancelInspection({ inspection, organization, officer, reason }) {
  const why = text(reason, 300)
  if (inspection.status !== 'SCHEDULED') throw new InspectionError('Only a scheduled inspection can be cancelled', 409)
  if (why.length < 5) throw new InspectionError('Give a reason for cancelling (at least 5 characters). The keeper will see it.')

  await db.transaction(async () => {
    await db.prepare("UPDATE inspections SET status = 'CANCELLED', cancel_reason = ? WHERE id = ?").run(why, inspection.id)
    await appendTraceabilityEvent({
      entityType: 'ORGANIZATION',
      entityId: organization.code,
      eventType: 'INSPECTION_CANCELLED',
      payload: { inspectionCode: inspection.inspection_code },
      createdBy: officer.id,
    })
    await sealPendingBlock()
  })()
}

export async function fileReport({ inspection, organization, officer, body }) {
  if (inspection.status !== 'SCHEDULED') throw new InspectionError('This inspection already has a report or was cancelled', 409)

  const conductedOn = text(body.conductedOn, 10)
  if (!isDate(conductedOn)) throw new InspectionError('Enter the date the inspection was carried out')
  if (conductedOn > today()) throw new InspectionError('The inspection date cannot be in the future')
  if (conductedOn < inspection.scheduled_date) throw new InspectionError(`The visit cannot be before the notified date (${inspection.scheduled_date})`)

  const inspectorName = text(body.inspectorName, 80)
  const presentPerson = text(body.presentPerson, 80)
  if (inspectorName.length < 2) throw new InspectionError('Enter the inspector name')
  if (presentPerson.length < 2) throw new InspectionError("Enter who represented the organisation during the visit")

  const checklist = {}
  for (const item of CHECKLIST) {
    const entry = (body.checklist || {})[item.id] || {}
    if (!RATINGS.includes(entry.rating)) throw new InspectionError(`Rate this point: ${item.label}`)
    const note = text(entry.note, 300)
    if (entry.rating === 'MAJOR' && note.length < 5) throw new InspectionError(`Describe the major finding for: ${item.label}`)
    checklist[item.id] = { rating: entry.rating, note }
  }

  const physical = Number(body.physicalStockKg)
  if (!Number.isFinite(physical) || physical < 0 || physical > 1000000) throw new InspectionError('Enter the honey stock counted on site in kg (0 if none)')

  if (!GRADES[body.grade]) throw new InspectionError('Choose a grade (A to D)')
  if (!OUTCOMES[body.outcome]) throw new InspectionError('Choose the outcome of the inspection')

  const remarks = text(body.remarks, 1500)
  if (remarks.length < 10) throw new InspectionError('Write your remarks (at least 10 characters). The keeper will see them.')

  let correctiveActions = null
  let correctiveDue = null
  if (['CORRECTIVE_ACTION', 'RE_INSPECTION'].includes(body.outcome)) {
    correctiveActions = text(body.correctiveActions, 800)
    correctiveDue = text(body.correctiveDue, 10)
    if (correctiveActions.length < 5) throw new InspectionError('List what the keeper must fix')
    if (!isDate(correctiveDue) || correctiveDue <= today()) throw new InspectionError('Set a deadline in the future for the corrective actions')
  }

  const suggested = suggestGrade(checklist)
  const chainKg = await chainStockKg(organization.id)
  const now = new Date().toISOString()

  await db.transaction(async () => {
    await db.prepare(`
      UPDATE inspections SET status = 'COMPLETED', conducted_on = ?, inspector_name = ?, present_person = ?,
        checklist_json = ?, physical_stock_kg = ?, chain_stock_kg = ?, grade = ?, outcome = ?, remarks = ?,
        corrective_actions = ?, corrective_due = ?, internal_note = ?, reported_by = ?, reported_at = ?
      WHERE id = ?
    `).run(conductedOn, inspectorName, presentPerson, JSON.stringify(checklist), physical, chainKg, body.grade,
      body.outcome, remarks, correctiveActions, correctiveDue, text(body.internalNote, 800) || null, officer.id, now, inspection.id)

    await appendTraceabilityEvent({
      entityType: 'ORGANIZATION',
      entityId: organization.code,
      eventType: 'INSPECTION_COMPLETED',
      payload: { inspectionCode: inspection.inspection_code, grade: body.grade, outcome: body.outcome, conductedOn },
      createdBy: officer.id,
    })
    await sealPendingBlock()
  })()

  return { suggestedGrade: suggested, chainStockKg: chainKg }
}

// Poor grades, or a recommendation in the report, allow a closure notice to be issued.
export function canIssueClosure(row) {
  return row.status === 'COMPLETED' && !row.closure_notice_at
    && (['C', 'D'].includes(row.grade) || row.outcome === 'CLOSURE_RECOMMENDED')
}

// What the keeper should be told about, newest first.
export async function keeperInspections(orgId) {
  return (await db.prepare(`${SELECT_BASE} WHERE i.org_id = ? ORDER BY i.id DESC LIMIT 50`).all(orgId))
    .map((row) => inspectionView(row, { forKeeper: true }))
}

export async function upcomingFor(orgId) {
  const row = await db.prepare("SELECT inspection_code, scheduled_date, scheduled_time, acknowledged_at FROM inspections WHERE org_id = ? AND status = 'SCHEDULED' ORDER BY scheduled_date LIMIT 1").get(orgId)
  if (!row) return null

  return {
    code: row.inspection_code,
    date: row.scheduled_date,
    time: row.scheduled_time,
    acknowledged: Boolean(row.acknowledged_at),
    tomorrow: row.scheduled_date === addDays(1),
    today: row.scheduled_date === today(),
  }
}
