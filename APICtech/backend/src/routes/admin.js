import crypto from 'node:crypto'
import express from 'express'
import bcrypt from 'bcryptjs'

import db from '../database/database.js'
import { REGIONS, isValidJurisdiction } from '../config/regions.js'
import { authenticateToken, requireRole } from '../middleware/auth.js'
import { ROLES, OFFICER_ROLES, canSeeIncome, inScope, orgScope } from '../services/access.js'
import { recordAudit } from '../services/audit.js'
import { AnnouncementError, composerTargets, createAnnouncement, visibleAnnouncements, withdrawAnnouncement } from '../services/announcements.js'
import {
  getBlock,
  getChainSummary,
  listBlocks,
  searchEvents,
  sealPendingBlock,
  validateBlockchain,
} from '../services/blockchain.js'
import { batchCapacity, parseJson } from '../services/batches.js'
import { ClosureError, applicableItems, closureView, completeClosure, getOpenClosure, readiness } from '../services/closure.js'
import {
  CHECKLIST, GRADES, InspectionError, OUTCOMES, PURPOSES, RATINGS, canIssueClosure, cancelInspection, chainStockKg, fileReport,
  inspectionRows, inspectionView, scheduleInspection,
} from '../services/inspections.js'
import { SigningError, signAsOfficer } from '../services/signing.js'
import { REQUIRE_LAB_DOCUMENT, sendDocument } from '../services/labDocuments.js'
import { onLabVerified, chainStatus, recentOutbox } from '../services/chain.js'
import { allOffices } from '../services/offices.js'
import { BACKUP_DIR, backupNow, listBackups, verifyDatabases } from '../services/backup.js'
import {
  TicketError, decideCentral, escalate, getTicket, officerMessage, officerThread, officerTickets, returnTicket, setStatus, ticketAlerts,
} from '../services/tickets.js'
import { currentMonth, recentMonths } from '../services/reports.js'
import { appendTraceabilityEvent } from '../services/traceabilityLog.js'

// The admin routes only read the common secure database. Company private
// databases are never opened from here.
const router = express.Router()
router.use(authenticateToken, requireRole(...OFFICER_ROLES))

const isMonth = (value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
const toInt = (value, fallback, max = 200) => Math.min(Math.max(Number.parseInt(value, 10) || fallback, 1), max)

async function scopedOrganizations(user, { status, query } = {}) {
  const scope = orgScope(user)
  const conditions = []
  const params = [...scope.params]

  if (status && status !== 'ALL') {
    conditions.push('o.status = ?')
    params.push(status)
  }

  if (query) {
    conditions.push('(o.legal_name LIKE ? OR o.organization_code LIKE ? OR o.madhukranti_id LIKE ?)')
    params.push(`%${query}%`, `%${query}%`, `%${query}%`)
  }

  return await db.prepare(`
    SELECT o.id, o.organization_code AS code, o.legal_name AS name, o.organization_type AS type,
      o.registration_body AS registrationBody, o.madhukranti_id AS registrationId,
      o.fssai_license AS fssai, o.gstin, o.state, o.region, o.status,
      o.created_at AS createdAt, o.reviewed_at AS reviewedAt, o.review_note AS reviewNote,
      rb.name AS reviewedBy, u.name AS ownerName, s.phone, s.email,
      o.address_line AS addressLine, o.locality, o.district, o.pincode, o.address_sample AS addressSample
    FROM organizations o
    JOIN users u ON u.id = o.owner_user_id
    LEFT JOIN user_settings s ON s.user_id = u.id
    LEFT JOIN users rb ON rb.id = o.reviewed_by
    WHERE 1 = 1 ${scope.sql} ${conditions.length ? `AND ${conditions.join(' AND ')}` : ''}
    ORDER BY o.created_at DESC, o.id DESC
  `).all(...params)
}

async function getScopedOrganization(user, id) {
  return (await scopedOrganizations(user)).find((organization) => organization.id === Number(id)) || null
}

async function totalsByOrg(query, ...params) {
  return new Map((await db.prepare(query).all(...params)).map((row) => [row.org_id, row]))
}

async function withMetrics(user, organizations) {
  const month = currentMonth()
  const batches = await totalsByOrg(`
    SELECT org_id, COUNT(*) AS batches, COALESCE(SUM(quantity_kg), 0) AS honey_kg
    FROM batches WHERE org_id IS NOT NULL GROUP BY org_id
  `)
  const bottles = await totalsByOrg(`
    SELECT b.org_id, COUNT(*) AS bottles
    FROM packs p
    JOIN pack_batches pb ON pb.id = p.pack_batch_id
    JOIN batches b ON b.id = pb.batch_id
    GROUP BY b.org_id
  `)
  const income = await totalsByOrg(`
    SELECT org_id, SUM(income_inr) AS total,
      SUM(CASE WHEN month = ? THEN income_inr ELSE 0 END) AS this_month
    FROM monthly_reports GROUP BY org_id
  `, month)

  return organizations.map((organization) => ({
    ...organization,
    batchCount: batches.get(organization.id)?.batches || 0,
    honeyKg: batches.get(organization.id)?.honey_kg || 0,
    bottles: bottles.get(organization.id)?.bottles || 0,
    ...(canSeeIncome(user)
      ? {
          totalIncomeInr: income.get(organization.id)?.total || 0,
          monthIncomeInr: income.get(organization.id)?.this_month || 0,
        }
      : {}),
  }))
}

async function monthlySeries(user, months) {
  const scope = orgScope(user)
  const honey = new Map((await db.prepare(`
    SELECT substr(b.harvest_date, 1, 7) AS month, SUM(b.quantity_kg) AS kg
    FROM batches b JOIN organizations o ON o.id = b.org_id
    WHERE 1 = 1 ${scope.sql} GROUP BY month
  `).all(...scope.params)).map((row) => [row.month, row.kg]))

  const bottles = new Map((await db.prepare(`
    SELECT substr(p.created_at, 1, 7) AS month, COUNT(*) AS count
    FROM packs p
    JOIN pack_batches pb ON pb.id = p.pack_batch_id
    JOIN batches b ON b.id = pb.batch_id
    JOIN organizations o ON o.id = b.org_id
    WHERE 1 = 1 ${scope.sql} GROUP BY month
  `).all(...scope.params)).map((row) => [row.month, row.count]))

  const income = new Map((await db.prepare(`
    SELECT m.month, SUM(m.income_inr) AS total
    FROM monthly_reports m JOIN organizations o ON o.id = m.org_id
    WHERE 1 = 1 ${scope.sql} GROUP BY m.month
  `).all(...scope.params)).map((row) => [row.month, row.total]))

  return months.map((month) => ({
    month,
    honeyKg: honey.get(month) || 0,
    bottles: bottles.get(month) || 0,
    ...(canSeeIncome(user) ? { incomeInr: income.get(month) || 0 } : {}),
  }))
}

async function pendingCounts(officer) {
  const scope = orgScope(officer)

  return {
    pendingOrganizations: (await db.prepare(`
      SELECT COUNT(*) AS count FROM organizations o
      WHERE o.status = 'PENDING_APPROVAL' ${scope.sql}
    `).get(...scope.params)).count,
    pendingClosures: (await db.prepare(`
      SELECT COUNT(*) AS count FROM organizations o
      WHERE o.status = 'CLOSURE_PENDING' ${scope.sql}
    `).get(...scope.params)).count,
    openSupport: await (async () => { const alerts = await ticketAlerts(officer); return alerts.needReply + alerts.awaitingApproval + alerts.escalated })(),
    inspectionsDue: (await db.prepare(`
      SELECT COUNT(*) AS count FROM inspections i
      JOIN organizations o ON o.id = i.org_id
      WHERE i.status = 'SCHEDULED' AND i.scheduled_date <= ? ${scope.sql}
    `).get(new Date().toLocaleDateString('en-CA'), ...scope.params)).count,
    pendingLabReviews: (await db.prepare(`
      SELECT COUNT(*) AS count FROM lab_reviews r
      JOIN organizations o ON o.id = r.org_id
      WHERE r.status = 'PENDING' ${scope.sql}
    `).get(...scope.params)).count,
  }
}

// --------------------------------------------------------------- overview
router.get('/overview', async (req, res) => {
  const { user } = req
  const scope = orgScope(user)

  const statuses = Object.fromEntries(
    (await db.prepare(`
      SELECT o.status, COUNT(*) AS count FROM organizations o WHERE 1 = 1 ${scope.sql} GROUP BY o.status
    `).all(...scope.params)).map((row) => [row.status, row.count]),
  )

  const honey = await db.prepare(`
    SELECT COUNT(*) AS batches, COALESCE(SUM(b.quantity_kg), 0) AS kg
    FROM batches b JOIN organizations o ON o.id = b.org_id WHERE 1 = 1 ${scope.sql}
  `).get(...scope.params)

  const bottles = (await db.prepare(`
    SELECT COUNT(*) AS count FROM packs p
    JOIN pack_batches pb ON pb.id = p.pack_batch_id
    JOIN batches b ON b.id = pb.batch_id
    JOIN organizations o ON o.id = b.org_id WHERE 1 = 1 ${scope.sql}
  `).get(...scope.params)).count

  const series = await monthlySeries(user, recentMonths(6))

  const recentBatches = await db.prepare(`
    SELECT b.batch_code AS code, b.quantity_kg AS quantityKg, b.honey_type AS honeyType,
      b.harvest_date AS harvestDate, b.status, o.legal_name AS orgName, b.created_at AS createdAt
    FROM batches b JOIN organizations o ON o.id = b.org_id
    WHERE 1 = 1 ${scope.sql} ORDER BY b.id DESC LIMIT 6
  `).all(...scope.params)

  const overview = {
    role: user.role,
    organizations: {
      total: Object.values(statuses).reduce((sum, count) => sum + count, 0),
      approved: statuses.APPROVED || 0,
      pending: statuses.PENDING_APPROVAL || 0,
      rejected: statuses.REJECTED || 0,
      suspended: statuses.SUSPENDED || 0,
      closing: statuses.CLOSURE_PENDING || 0,
      closed: statuses.CLOSED || 0,
    },
    ...await pendingCounts(user),
    batches: honey.batches,
    honeyKg: honey.kg,
    bottles,
    series,
    recentBatches,
    chain: { ...await getChainSummary(), integrity: await validateBlockchain() },
  }

  if (canSeeIncome(user)) {
    overview.monthIncomeInr = series.at(-1).incomeInr
  }

  if (user.role === ROLES.HEAD) {
    overview.officers = await db.prepare(`
      SELECT role, COUNT(*) AS total, COALESCE(SUM(active), 0) AS active
      FROM users WHERE role IN ('STATE_OFFICER', 'REGIONAL_OFFICER') GROUP BY role
    `).all()
  }

  res.json(overview)
})

// ---------------------------------------------------------- organisations
router.get('/organizations', async (req, res) => {
  const organizations = await scopedOrganizations(req.user, {
    status: req.query.status,
    query: String(req.query.q || '').trim(),
  })

  res.json(await withMetrics(req.user, organizations))
})

router.get('/organizations/:id', async (req, res) => {
  const organization = await getScopedOrganization(req.user, req.params.id)
  if (!organization) return res.status(404).json({ message: 'Organisation not found in your jurisdiction' })

  const [withDetails] = await withMetrics(req.user, [organization])

  const batches = await db.prepare(`
    SELECT b.id, b.batch_code AS code, b.quantity_kg AS quantityKg, b.honey_type AS honeyType,
      b.harvest_date AS harvestDate, b.status,
      (SELECT r.status FROM lab_reviews r WHERE r.batch_id = b.id ORDER BY r.id DESC LIMIT 1) AS labStatus,
      (SELECT COUNT(*) FROM packs p JOIN pack_batches pb ON pb.id = p.pack_batch_id WHERE pb.batch_id = b.id) AS bottles
    FROM batches b WHERE b.org_id = ? ORDER BY b.id DESC
  `).all(organization.id)

  const decisions = (await db.prepare(`
    SELECT a.id, a.action, a.detail_json, a.created_at AS createdAt, u.name AS officerName, a.actor_role AS officerRole
    FROM audit_log a JOIN users u ON u.id = a.actor_user_id
    WHERE a.action = 'ORG_DECISION' AND a.target_id = ? ORDER BY a.id DESC
  `).all(organization.code)).map((row) => ({ ...row, detail: parseJson(row.detail_json), detail_json: undefined }))

  const closureRow = await db.prepare('SELECT * FROM closure_requests WHERE org_id = ? ORDER BY id DESC LIMIT 1').get(organization.id)

  res.json({
    organization: withDetails,
    batches,
    decisions,
    closure: closureRow ? { ...closureView(closureRow), items: applicableItems({ gstin: organization.gstin }) } : null,
    ...(canSeeIncome(req.user)
      ? {
          monthlyIncome: await db.prepare(`
            SELECT month, income_inr AS incomeInr FROM monthly_reports
            WHERE org_id = ? ORDER BY month DESC LIMIT 12
          `).all(organization.id),
        }
      : {}),
  })
})

const ORG_TRANSITIONS = {
  PENDING_APPROVAL: { APPROVED: 'ALL', REJECTED: 'ALL' },
  APPROVED: { SUSPENDED: 'SENIOR' },
  REJECTED: { APPROVED: 'SENIOR' },
  SUSPENDED: { APPROVED: 'SENIOR' },
}

router.post('/organizations/:id/decision', async (req, res) => {
  const organization = await getScopedOrganization(req.user, req.params.id)
  if (!organization) return res.status(404).json({ message: 'Organisation not found in your jurisdiction' })

  const decision = String(req.body.decision || '')
  const note = String(req.body.note || '').trim().slice(0, 400)
  const rule = ORG_TRANSITIONS[organization.status]?.[decision]

  if (!rule) {
    return res.status(409).json({ message: `An organisation that is ${organization.status} cannot be set to ${decision}` })
  }

  if (rule === 'SENIOR' && req.user.role === ROLES.REGIONAL) {
    return res.status(403).json({ message: 'Only state officers and the KVIC head can suspend, reinstate or reverse a decision' })
  }

  if (['REJECTED', 'SUSPENDED'].includes(decision) && note.length < 5) {
    return res.status(400).json({ message: 'Add a short reason (at least 5 characters) for the organisation to see' })
  }

  await db.transaction(async () => {
    await db.prepare(`
      UPDATE organizations SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?
    `).run(decision, req.user.id, new Date().toISOString(), note || null, organization.id)

    // The decision itself is chained; the reason text stays in the audit log.
    await appendTraceabilityEvent({
      entityType: 'ORGANIZATION',
      entityId: organization.code,
      eventType: `ORGANIZATION_${decision}`,
      payload: {
        organizationCode: organization.code,
        decision,
        previousStatus: organization.status,
        decidedByRole: req.user.role,
        decidedByUserId: req.user.id,
      },
      createdBy: req.user.id,
    })
    await sealPendingBlock()

    await recordAudit(req.user, 'ORG_DECISION', 'ORGANIZATION', organization.code, {
      orgName: organization.name,
      decision,
      previousStatus: organization.status,
      note,
    })
  })()

  res.json({ id: organization.id, status: decision })
})

// ------------------------------------------------------- closing companies
// The formal deregistration of an organisation: an officer works through the
// government formalities checklist and completes the closure. Nothing is
// deleted: the blockchain record stays, the private records are archived.
async function closureRows(user, status) {
  const scope = orgScope(user)
  const params = [...scope.params]
  let statusSql = ''

  if (status === 'OPEN') statusSql = " AND c.status = 'REQUESTED'"
  else if (status === 'COMPLETED') statusSql = " AND c.status = 'COMPLETED'"

  return await Promise.all((await db.prepare(`
    SELECT c.*, o.id AS org_id, o.legal_name AS org_name, o.organization_code AS org_code,
      o.gstin, o.state, o.region, o.status AS org_status, u.name AS owner_name,
      cb.name AS completed_by_name, ins.inspection_code AS inspection_code, ins.grade AS inspection_grade
    FROM closure_requests c
    LEFT JOIN inspections ins ON ins.id = c.inspection_id
    JOIN organizations o ON o.id = c.org_id
    JOIN users u ON u.id = o.owner_user_id
    LEFT JOIN users cb ON cb.id = c.completed_by
    WHERE c.status IN ('REQUESTED', 'COMPLETED') ${statusSql} ${scope.sql}
    ORDER BY (c.status = 'REQUESTED') DESC, c.id DESC LIMIT 200
  `).all(...params)).map(async (row) => ({
    ...closureView(row),
    orgId: row.org_id,
    orgName: row.org_name,
    orgCode: row.org_code,
    gstin: row.gstin,
    state: row.state,
    region: row.region,
    ownerName: row.owner_name,
    completedBy: row.completed_by_name,
    inspectionCode: row.inspection_code || null,
    inspectionGrade: row.inspection_grade || null,
    items: applicableItems({ gstin: row.gstin }),
    readiness: row.status === 'REQUESTED' ? await readiness({ id: row.org_id }) : null,
  })))
}

router.get('/closures', async (req, res) => {
  res.json(await closureRows(req.user, String(req.query.status || 'ALL')))
})

// Starts a formal closure. Used for a plain officer notice and for one that follows an inspection.
async function startClosure(user, organization, reason, inspectionId = null) {
  await db.transaction(async () => {
    await db.prepare(`
      INSERT INTO closure_requests (org_id, initiated_by, initiated_by_role, reason, declarations_json, inspection_id)
      VALUES (?, ?, ?, ?, '{}', ?)
    `).run(organization.id, user.id, user.role, reason, inspectionId)
    await db.prepare("UPDATE organizations SET status = 'CLOSURE_PENDING' WHERE id = ?").run(organization.id)

    await appendTraceabilityEvent({
      entityType: 'ORGANIZATION',
      entityId: organization.code,
      eventType: 'ORGANIZATION_CLOSURE_REQUESTED',
      payload: { organizationCode: organization.code, requestedBy: user.role, ...(inspectionId ? { inspectionId } : {}) },
      createdBy: user.id,
    })
    await sealPendingBlock()

    await recordAudit(user, 'ORG_CLOSURE_STARTED', 'ORGANIZATION', organization.code, { orgName: organization.name, reason, inspectionId })
  })()
}

router.post('/organizations/:id/closure', async (req, res) => {
  const organization = await getScopedOrganization(req.user, req.params.id)
  if (!organization) return res.status(404).json({ message: 'Organisation not found in your jurisdiction' })

  if (!['APPROVED', 'SUSPENDED'].includes(organization.status)) {
    return res.status(409).json({ message: `An organisation that is ${organization.status} cannot enter closure` })
  }

  const reason = String(req.body.reason || '').trim().slice(0, 400)
  if (reason.length < 5) return res.status(400).json({ message: 'Record the reason for closure (at least 5 characters)' })

  await startClosure(req.user, organization, reason)
  res.status(201).json({ status: 'CLOSURE_PENDING' })
})

// ------------------------------------------------------------- inspections
// Officers schedule inspections (the keeper is told at least a day ahead), then
// file the visit report with a checklist, grade and remarks. A poor result can
// lead to a closure notice.
async function scopedInspection(req) {
  return (await inspectionRows({ scope: orgScope(req.user), id: Number(req.params.id) }))[0]
}

async function inspectionResponse(row) {
  return {
    ...inspectionView(row),
    orgName: row.org_name,
    orgCode: row.org_code,
    state: row.state,
    region: row.region,
    orgStatus: row.org_status,
    chainStockNow: await chainStockKg(row.org_id),
    canIssueClosure: canIssueClosure(row) && ['APPROVED', 'SUSPENDED'].includes(row.org_status),
  }
}

function handleInspectionError(error, res) {
  if (error instanceof InspectionError) return res.status(error.status).json({ message: error.message })
  throw error
}

router.get('/inspections/meta', (req, res) => {
  res.json({ purposes: PURPOSES, checklist: CHECKLIST, ratings: RATINGS, grades: GRADES, outcomes: OUTCOMES })
})

router.get('/inspections', async (req, res) => {
  const rows = await inspectionRows({ scope: orgScope(req.user), status: String(req.query.status || 'ALL'), orgId: Number(req.query.orgId) || undefined })
  res.json(await Promise.all(rows.map(inspectionResponse)))
})

router.post('/inspections', async (req, res) => {
  const organization = await getScopedOrganization(req.user, req.body.orgId)
  if (!organization) return res.status(404).json({ message: 'Organisation not found in your jurisdiction' })

  try {
    const created = await scheduleInspection({
      organization, officer: req.user, date: req.body.date, time: req.body.time, purpose: req.body.purpose, instructions: req.body.instructions,
    })
    await recordAudit(req.user, 'INSPECTION_SCHEDULED', 'ORGANIZATION', organization.code, { inspection: created.code, date: req.body.date, purpose: req.body.purpose })
    res.status(201).json(created)
  } catch (error) {
    handleInspectionError(error, res)
  }
})

router.post('/inspections/:id/cancel', async (req, res) => {
  const row = await scopedInspection(req)
  if (!row) return res.status(404).json({ message: 'Inspection not found in your jurisdiction' })

  try {
    await cancelInspection({ inspection: row, organization: { code: row.org_code }, officer: req.user, reason: req.body.reason })
    await recordAudit(req.user, 'INSPECTION_CANCELLED', 'ORGANIZATION', row.org_code, { inspection: row.inspection_code })
    res.json({ status: 'CANCELLED' })
  } catch (error) {
    handleInspectionError(error, res)
  }
})

router.post('/inspections/:id/report', async (req, res) => {
  const row = await scopedInspection(req)
  if (!row) return res.status(404).json({ message: 'Inspection not found in your jurisdiction' })

  try {
    const result = await fileReport({ inspection: row, organization: { id: row.org_id, code: row.org_code }, officer: req.user, body: req.body })
    await recordAudit(req.user, 'INSPECTION_REPORTED', 'ORGANIZATION', row.org_code, { inspection: row.inspection_code, grade: req.body.grade, outcome: req.body.outcome })
    res.json({ status: 'COMPLETED', ...result })
  } catch (error) {
    handleInspectionError(error, res)
  }
})

router.post('/inspections/:id/closure', async (req, res) => {
  const row = await scopedInspection(req)
  if (!row) return res.status(404).json({ message: 'Inspection not found in your jurisdiction' })

  if (!canIssueClosure(row)) {
    return res.status(409).json({ message: 'A closure notice needs a completed inspection graded C or D, or one that recommends closure' })
  }
  if (!['APPROVED', 'SUSPENDED'].includes(row.org_status)) {
    return res.status(409).json({ message: `An organisation that is ${row.org_status} cannot enter closure` })
  }

  const grounds = String(req.body.reason || '').trim().slice(0, 250)
  if (grounds.length < 5) return res.status(400).json({ message: 'Add the grounds for closure (at least 5 characters)' })

  const reason = `Following inspection ${row.inspection_code} (grade ${row.grade}): ${grounds}`
  await startClosure(req.user, { id: row.org_id, code: row.org_code, name: row.org_name }, reason, row.id)
  await db.prepare('UPDATE inspections SET closure_notice_at = ? WHERE id = ?').run(new Date().toISOString(), row.id)

  res.status(201).json({ status: 'CLOSURE_PENDING' })
})

async function scopedClosure(req) {
  return (await closureRows(req.user, 'OPEN')).find((row) => row.id === Number(req.params.id))
}

router.post('/closures/:id/complete', async (req, res) => {
  const closure = await scopedClosure(req)
  if (!closure) return res.status(404).json({ message: 'Open closure not found in your jurisdiction' })

  const organization = await db.prepare('SELECT * FROM organizations WHERE id = ?').get(closure.orgId)

  try {
    await completeClosure({
      closure: { id: closure.id },
      organization,
      officer: req.user,
      items: req.body.items,
      note: req.body.note,
    })
  } catch (error) {
    if (error instanceof ClosureError) return res.status(error.status).json({ message: error.message })
    throw error
  }

  res.json({ status: 'CLOSED' })
})

router.post('/closures/:id/decline', async (req, res) => {
  const closure = await scopedClosure(req)
  if (!closure) return res.status(404).json({ message: 'Open closure not found in your jurisdiction' })

  const note = String(req.body.note || '').trim().slice(0, 400)
  if (note.length < 5) return res.status(400).json({ message: 'Explain why the closure is declined (at least 5 characters)' })

  await db.transaction(async () => {
    await db.prepare("UPDATE closure_requests SET status = 'DECLINED', completion_note = ?, completed_by = ?, completed_at = ? WHERE id = ?")
      .run(note, req.user.id, new Date().toISOString(), closure.id)
    await db.prepare("UPDATE organizations SET status = 'APPROVED', review_note = ? WHERE id = ?").run(note, closure.orgId)
    await recordAudit(req.user, 'ORG_CLOSURE_DECLINED', 'ORGANIZATION', closure.orgCode, { orgName: closure.orgName, note })
  })()

  res.json({ status: 'APPROVED' })
})

// ----------------------------------------------------------- notice board
// Notices between offices and to keepers. Who can read a notice is decided in
// services/announcements.js: a regional officer's notice reaches only keepers of
// that region (state and national officers see it as oversight), national and
// state notices reach everyone they address, and officer-only notices never
// reach keepers.
router.get('/announcements/targets', async (req, res) => {
  res.json(await composerTargets(req.user))
})

router.get('/announcements', async (req, res) => {
  res.json(await visibleAnnouncements(req.user, { limit: Math.min(Number(req.query.limit) || 60, 100) }))
})

router.post('/announcements', async (req, res) => {
  try {
    const created = await createAnnouncement(req.user, req.body)
    await recordAudit(req.user, 'ANNOUNCEMENT_SENT', 'ANNOUNCEMENT', created.id, { title: created.title, audience: created.audienceLabel })
    res.status(201).json(created)
  } catch (error) {
    if (error instanceof AnnouncementError) return res.status(error.status).json({ message: error.message })
    throw error
  }
})

router.delete('/announcements/:id', async (req, res) => {
  try {
    const row = await withdrawAnnouncement(req.user, req.params.id)
    await recordAudit(req.user, 'ANNOUNCEMENT_WITHDRAWN', 'ANNOUNCEMENT', row.id, { title: row.title })
    res.json({ withdrawn: true })
  } catch (error) {
    if (error instanceof AnnouncementError) return res.status(error.status).json({ message: error.message })
    throw error
  }
})

// ------------------------------------------------------ help desk and roles
// Tickets: conversations between keepers and their regional officer, escalated to the state
// office directly, or to the central office only with the state officer's approval.
const ticketFail = (error, res) => {
  if (error instanceof TicketError) return res.status(error.status).json({ message: error.message })
  throw error
}

router.get('/tickets', async (req, res) => {
  res.json(await officerTickets(req.user, String(req.query.filter || 'ALL')))
})

router.get('/tickets/:id', async (req, res) => {
  const thread = await officerThread(req.user, req.params.id)
  if (!thread) return res.status(404).json({ message: 'Ticket not found in your jurisdiction' })
  res.json(thread)
})

async function withTicket(req, res, handler, auditAction) {
  const ticket = await getTicket(req.params.id)
  if (!ticket || !await officerThread(req.user, ticket.id)) return res.status(404).json({ message: 'Ticket not found in your jurisdiction' })

  try {
    const result = await handler(ticket)
    await recordAudit(req.user, auditAction, 'TICKET', ticket.ticket_code, { level: ticket.level })
    res.json(result ?? { ok: true })
  } catch (error) { ticketFail(error, res) }
}

router.post('/tickets/:id/messages', async (req, res) => {
  const ticket = await getTicket(req.params.id)
  if (!ticket) return res.status(404).json({ message: 'Ticket not found in your jurisdiction' })

  try {
    await officerMessage({ ticket, user: req.user, body: req.body.body, internal: Boolean(req.body.internal) })
    res.status(201).json({ sent: true })
  } catch (error) { ticketFail(error, res) }
})

router.post('/tickets/:id/escalate', async (req, res) => await withTicket(req, res, async (ticket) => await escalate({ ticket, user: req.user, target: req.body.target, reason: req.body.reason }), 'TICKET_ESCALATED'))
router.post('/tickets/:id/central-decision', async (req, res) => await withTicket(req, res, async (ticket) => await decideCentral({ ticket, user: req.user, decision: req.body.decision, note: req.body.note }), 'TICKET_CENTRAL_DECISION'))
router.post('/tickets/:id/return', async (req, res) => await withTicket(req, res, async (ticket) => await returnTicket({ ticket, user: req.user, note: req.body.note }), 'TICKET_RETURNED'))
router.post('/tickets/:id/close', async (req, res) => await withTicket(req, res, async (ticket) => await setStatus({ ticket, user: req.user, status: 'CLOSED', note: req.body.note }), 'TICKET_CLOSED'))
router.post('/tickets/:id/reopen', async (req, res) => await withTicket(req, res, async (ticket) => await setStatus({ ticket, user: req.user, status: 'OPEN' }), 'TICKET_REOPENED'))

// Who is responsible for which state and region, limited to the viewer's own line of command.
router.get('/directory', async (req, res) => {
  const { user } = req
  const officers = await db.prepare("SELECT id, name, username, role, state, region, active FROM users WHERE role IN ('REGIONAL_OFFICER', 'STATE_OFFICER', 'KVIC_HEAD') ORDER BY name").all()
  const counts = await db.prepare(`
    SELECT state, region,
      SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) AS approved, SUM(CASE WHEN status = 'PENDING_APPROVAL' THEN 1 ELSE 0 END) AS pending, COUNT(*) AS total
    FROM organizations GROUP BY state, region
  `).all()
  const states = user.role === ROLES.HEAD ? Object.keys(REGIONS) : [user.state]
  const offices = await allOffices()
  const officeOf = (level, state = '', region = '') => offices.find((office) => office.level === level && (office.state || '') === state && (office.region || '') === region) || null

  res.json({
    nationalOffice: officeOf('CENTRAL'),
    national: officers.filter((row) => row.role === ROLES.HEAD),
    states: states.map((state) => ({
      state,
      office: officeOf('STATE', state),
      officers: officers.filter((row) => row.role === ROLES.STATE && row.state === state),
      regions: REGIONS[state]
        .filter((region) => user.role !== ROLES.REGIONAL || region === user.region)
        .map((region) => ({
          region,
          office: officeOf('REGIONAL', state, region),
          officers: officers.filter((row) => row.role === ROLES.REGIONAL && row.state === state && row.region === region),
          organizations: counts.find((row) => row.state === state && row.region === region) || { approved: 0, pending: 0, total: 0 },
        })),
    })),
  })
})

// The bell in the top bar: what needs this officer's attention, plus notices from other offices.
router.get('/notifications', async (req, res) => {
  const counts = await pendingCounts(req.user)
  const alerts = await ticketAlerts(req.user)
  const now = new Date().toISOString()
  const items = []

  if (counts.pendingOrganizations) items.push({ id: 'orgs', kind: 'requests', tone: 'amber', title: `${counts.pendingOrganizations} registration(s) awaiting a decision`, text: 'New organisations want to join the KVIC chain.', time: now, go: 'requests', params: { tab: 'organizations' } })
  if (counts.pendingLabReviews) items.push({ id: 'labs', kind: 'requests', tone: 'amber', title: `${counts.pendingLabReviews} lab result(s) to verify`, text: 'Shared by beekeepers for your signature.', time: now, go: 'requests', params: { tab: 'labs' } })
  if (counts.pendingClosures) items.push({ id: 'closures', kind: 'requests', tone: 'rose', title: `${counts.pendingClosures} closure(s) in progress`, text: 'Complete the government formalities checklist.', time: now, go: 'requests', params: { tab: 'closures' } })
  if (counts.inspectionsDue) items.push({ id: 'insp', kind: 'inspection', tone: 'blue', title: `${counts.inspectionsDue} inspection(s) ready for a report`, text: 'The notified date has arrived.', time: now, go: 'inspections' })
  if (alerts.needReply) items.push({ id: 'tickets-reply', kind: 'help', tone: 'green', title: `${alerts.needReply} keeper message(s) waiting for your reply`, text: 'Open the tickets in Help & roles.', time: now, go: 'help', params: { tab: 'tickets' } })
  if (alerts.awaitingApproval) items.push({ id: 'tickets-approve', kind: 'help', tone: 'rose', title: `${alerts.awaitingApproval} urgent ticket(s) need your approval`, text: 'A regional officer wants to take them to the central office.', time: now, go: 'help', params: { tab: 'tickets' } })
  if (alerts.escalated) items.push({ id: 'tickets-escalated', kind: 'help', tone: 'blue', title: `${alerts.escalated} escalated ticket(s) open`, text: 'Read them and leave notes for the regional officer.', time: now, go: 'help', params: { tab: 'tickets' } })

  for (const notice of (await visibleAnnouncements(req.user, { limit: 8 })).filter((row) => row.relation !== 'sent')) {
    items.push({
      id: `notice-${notice.id}`,
      kind: 'notice',
      tone: notice.priority === 'URGENT' ? 'rose' : 'gold',
      title: `${notice.from} sent: ${notice.title}`,
      text: notice.relation === 'received' ? notice.audienceLabel : `${notice.relation === 'oversight' ? 'Oversight' : 'For keepers in your area'} · ${notice.audienceLabel}`,
      time: notice.createdAt,
      go: 'notices',
    })
  }

  res.json(items)
})

// -------------------------------------------------------------- lab reviews
async function labReviewRows(user, status) {
  const scope = orgScope(user)
  const params = [...scope.params]
  let statusSql = ''

  if (status && status !== 'ALL') {
    statusSql = ' AND r.status = ?'
    params.push(status)
  }

  return (await db.prepare(`
    SELECT r.id, r.status, r.review_note AS reviewNote, r.reviewed_at AS reviewedAt,
      r.created_at AS submittedAt, rb.name AS reviewedBy,
      o.id AS orgId, o.legal_name AS orgName, o.organization_code AS orgCode, o.state, o.region,
      b.batch_code AS batchCode, b.quantity_kg AS quantityKg, b.honey_type AS honeyType,
      b.harvest_date AS harvestDate,
      t.lab_name AS labName, t.certificate_reference AS certificateReference,
      t.status AS declaredStatus, t.tested_at AS testedAt, t.results_json,
      r.ai_analysis_json, r.signed_at AS signedAt, k.fingerprint AS signatureFingerprint,
      r.document_name AS documentName, r.document_size AS documentSize, r.document_sha256 AS documentSha256,
      r.document_uploaded_at AS documentUploadedAt
    FROM lab_reviews r
    JOIN organizations o ON o.id = r.org_id
    JOIN batches b ON b.id = r.batch_id
    JOIN laboratory_tests t ON t.id = r.lab_test_id
    LEFT JOIN users rb ON rb.id = r.reviewed_by
    LEFT JOIN officer_keys k ON k.id = r.signing_key_id
    WHERE 1 = 1 ${scope.sql} ${statusSql}
    ORDER BY (r.status = 'PENDING') DESC, r.id DESC
    LIMIT 200
  `).all(...params)).map((row) => ({ ...row, results: parseJson(row.results_json), results_json: undefined, ai: parseJson(row.ai_analysis_json), ai_analysis_json: undefined }))
}

// The keeper's scanned certificate, for the officer who covers that region.
router.get('/lab-reviews/:id/document', async (req, res) => {
  const review = (await labReviewRows(req.user, 'ALL')).find((row) => row.id === Number(req.params.id))
  if (!review) return res.status(404).json({ message: 'Lab review not found in your jurisdiction' })

  const stored = await db.prepare('SELECT document_file, document_name FROM lab_reviews WHERE id = ?').get(review.id)
  return sendDocument(res, stored)
})

router.get('/lab-reviews', async (req, res) => {
  res.json(await labReviewRows(req.user, String(req.query.status || 'ALL')))
})

// AI analyses, the officer decides. Verifying a certificate requires the
// officer to confirm their password, which unlocks their signing key: the
// signature over the certificate details becomes part of the chain record.
router.post('/lab-reviews/:id/decision', async (req, res) => {
  const review = (await labReviewRows(req.user, 'ALL')).find((row) => row.id === Number(req.params.id))
  if (!review) return res.status(404).json({ message: 'Lab review not found in your jurisdiction' })

  if (review.status !== 'PENDING') {
    return res.status(409).json({ message: 'This lab result has already been reviewed' })
  }

  const decision = String(req.body.decision || '')
  const note = String(req.body.note || '').trim().slice(0, 400)

  if (!['VERIFIED', 'REJECTED'].includes(decision)) {
    return res.status(400).json({ message: 'Decision must be VERIFIED or REJECTED' })
  }

  if (REQUIRE_LAB_DOCUMENT && decision === 'VERIFIED' && !review.documentName) {
    return res.status(409).json({ message: 'The keeper has not uploaded the scanned certificate yet' })
  }

  if (decision === 'REJECTED' && note.length < 5) {
    return res.status(400).json({ message: 'Add a short reason (at least 5 characters) for the beekeeper to see' })
  }

  const decidedAt = new Date().toISOString()
  let signing = null

  if (decision === 'VERIFIED') {
    try {
      signing = await signAsOfficer(req.user, req.body.password, {
        v: 1,
        kind: 'LAB_CERTIFICATE_VERIFICATION',
        batchCode: review.batchCode,
        organizationId: review.orgId,
        certificateReference: review.certificateReference,
        laboratory: review.labName,
        declaredStatus: review.declaredStatus,
        testedAt: review.testedAt,
        resultsHash: crypto.createHash('sha256').update(JSON.stringify(review.results || {})).digest('hex'),
        decision,
        officerId: req.user.id,
        officerName: req.user.name,
        officerRole: req.user.role,
        state: req.user.state,
        region: req.user.region,
        signedAt: decidedAt,
      })
    } catch (error) {
      if (error instanceof SigningError) return res.status(error.status).json({ message: error.message })
      throw error
    }
  }

  // Signing awaited a password check; make sure nobody else decided meanwhile.
  if ((await db.prepare('SELECT status FROM lab_reviews WHERE id = ?').get(review.id)).status !== 'PENDING') {
    return res.status(409).json({ message: 'This lab result has already been reviewed' })
  }

  await db.transaction(async () => {
    await db.prepare(`
      UPDATE lab_reviews
      SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?,
        signed_payload = ?, signature = ?, signing_key_id = ?, signed_at = ?
      WHERE id = ?
    `).run(
      decision, req.user.id, decidedAt, note || null,
      signing?.signedPayload ?? null, signing?.signature ?? null, signing?.keyId ?? null, signing ? decidedAt : null,
      review.id,
    )

    // Batches already moving through the supply chain keep their status.
    await db.prepare(`
      UPDATE batches SET status = ?
      WHERE batch_code = ? AND status IN ('HARVESTED', 'CREATED', 'LAB_TESTED', 'LAB_REVIEW')
    `).run(decision === 'VERIFIED' && review.declaredStatus === 'PASSED' ? 'LAB_TESTED' : 'LAB_REVIEW', review.batchCode)

    await appendTraceabilityEvent({
      entityType: 'BATCH',
      entityId: review.batchCode,
      eventType: `LAB_RESULT_${decision}`,
      payload: {
        certificateReference: review.certificateReference,
        declaredStatus: review.declaredStatus,
        decidedByRole: req.user.role,
        decidedByUserId: req.user.id,
        aiRiskLevel: review.ai?.riskLevel ?? null,
        ...(signing
          ? {
              signature: signing.signature,
              signatureKeyFingerprint: signing.fingerprint,
              signedPayloadHash: crypto.createHash('sha256').update(signing.signedPayload).digest('hex'),
            }
          : {}),
      },
      createdBy: req.user.id,
    })
    await sealPendingBlock()

    await recordAudit(req.user, 'LAB_DECISION', 'BATCH', review.batchCode, {
      orgName: review.orgName,
      decision,
      certificateReference: review.certificateReference,
      aiRiskLevel: review.ai?.riskLevel ?? null,
      signed: Boolean(signing),
      note,
    })
  })()

  if (decision === 'VERIFIED') await onLabVerified({ review, officer: req.user, passed: review.declaredStatus === 'PASSED' })

  res.json({ id: review.id, status: decision, signed: Boolean(signing), keyFingerprint: signing?.fingerprint ?? null })
})

// ------------------------------------------------------------- system health
// Databases, backups and the blockchain link, for the KVIC head.
router.get('/system/health', async (req, res) => {
  if (req.user.role !== ROLES.HEAD) return res.status(403).json({ message: 'Only the KVIC head can see system health' })

  res.json({
    databases: await verifyDatabases(),
    backups: { folder: BACKUP_DIR, latest: listBackups().slice(0, 5) },
    chain: await chainStatus(),
    outbox: await recentOutbox(25),
  })
})

router.post('/system/backup', async (req, res) => {
  if (req.user.role !== ROLES.HEAD) return res.status(403).json({ message: 'Only the KVIC head can take a backup' })
  const made = await backupNow(db)
  await await recordAudit(req.user, 'BACKUP_TAKEN', 'SYSTEM', made.name, { files: made.files })
  res.status(201).json(made)
})

// ------------------------------------------------- production and income
router.get('/reports/organizations', async (req, res) => {
  if (!canSeeIncome(req.user)) {
    return res.status(403).json({ message: 'Income reports are available to state officers and the KVIC head' })
  }

  const month = isMonth(req.query.month) ? req.query.month : currentMonth()
  const organizations = await scopedOrganizations(req.user, { status: 'APPROVED' })

  const honey = await totalsByOrg(`
    SELECT org_id, COUNT(*) AS batches, SUM(quantity_kg) AS kg FROM batches
    WHERE substr(harvest_date, 1, 7) = ? GROUP BY org_id
  `, month)
  const honeyTotal = await totalsByOrg('SELECT org_id, SUM(quantity_kg) AS kg FROM batches GROUP BY org_id')
  const bottles = await totalsByOrg(`
    SELECT b.org_id, COUNT(*) AS count FROM packs p
    JOIN pack_batches pb ON pb.id = p.pack_batch_id JOIN batches b ON b.id = pb.batch_id
    WHERE substr(p.created_at, 1, 7) = ? GROUP BY b.org_id
  `, month)
  const bottlesTotal = await totalsByOrg(`
    SELECT b.org_id, COUNT(*) AS count FROM packs p
    JOIN pack_batches pb ON pb.id = p.pack_batch_id JOIN batches b ON b.id = pb.batch_id
    GROUP BY b.org_id
  `)
  const income = await totalsByOrg('SELECT org_id, income_inr AS income FROM monthly_reports WHERE month = ?', month)

  const rows = organizations.map((organization) => ({
    id: organization.id,
    code: organization.code,
    name: organization.name,
    state: organization.state,
    region: organization.region,
    batchesInMonth: honey.get(organization.id)?.batches || 0,
    honeyKgInMonth: honey.get(organization.id)?.kg || 0,
    honeyKgTotal: honeyTotal.get(organization.id)?.kg || 0,
    bottlesInMonth: bottles.get(organization.id)?.count || 0,
    bottlesTotal: bottlesTotal.get(organization.id)?.count || 0,
    incomeInr: income.get(organization.id)?.income || 0,
  }))

  const sum = (key) => rows.reduce((total, row) => total + row[key], 0)

  res.json({
    month,
    months: recentMonths(12).reverse(),
    rows,
    totals: {
      honeyKgInMonth: sum('honeyKgInMonth'),
      bottlesInMonth: sum('bottlesInMonth'),
      bottlesTotal: sum('bottlesTotal'),
      incomeInr: sum('incomeInr'),
    },
    series: await monthlySeries(req.user, recentMonths(12)),
  })
})

// ------------------------------------------------------------------ batches
router.get('/batches', async (req, res) => {
  const scope = orgScope(req.user)
  const params = [...scope.params]
  const conditions = []

  if (req.query.orgId) {
    conditions.push('o.id = ?')
    params.push(Number(req.query.orgId))
  }

  const query = String(req.query.q || '').trim()
  if (query) {
    conditions.push('(b.batch_code LIKE ? OR o.legal_name LIKE ?)')
    params.push(`%${query}%`, `%${query}%`)
  }

  res.json(await db.prepare(`
    SELECT b.batch_code AS code, b.quantity_kg AS quantityKg, b.honey_type AS honeyType,
      b.harvest_date AS harvestDate, b.status, b.created_at AS createdAt,
      o.id AS orgId, o.legal_name AS orgName, o.organization_code AS orgCode,
      (SELECT r.status FROM lab_reviews r WHERE r.batch_id = b.id ORDER BY r.id DESC LIMIT 1) AS labStatus,
      (SELECT COUNT(*) FROM packs p JOIN pack_batches pb ON pb.id = p.pack_batch_id WHERE pb.batch_id = b.id) AS bottles
    FROM batches b JOIN organizations o ON o.id = b.org_id
    WHERE 1 = 1 ${scope.sql} ${conditions.length ? `AND ${conditions.join(' AND ')}` : ''}
    ORDER BY b.id DESC LIMIT 200
  `).all(...params))
})

router.get('/batches/:code', async (req, res) => {
  const scope = orgScope(req.user)
  const batch = await db.prepare(`
    SELECT b.*, o.legal_name AS org_name, o.organization_code AS org_code
    FROM batches b JOIN organizations o ON o.id = b.org_id
    WHERE b.batch_code = ? ${scope.sql}
  `).get(req.params.code, ...scope.params)

  if (!batch) return res.status(404).json({ message: 'Batch not found in your jurisdiction' })

  const packBatches = await db.prepare(`
    SELECT pb.pack_batch_code AS code, pb.product_name AS productName, pb.jar_size_grams AS jarSizeGrams,
      pb.quantity_to_pack AS quantityToPack, pb.created_at AS createdAt,
      (SELECT COUNT(*) FROM packs p WHERE p.pack_batch_id = pb.id) AS packsCreated
    FROM pack_batches pb WHERE pb.batch_id = ? ORDER BY pb.id
  `).all(batch.id)

  const events = [
    ...await searchEvents({ entityType: 'BATCH', entityId: batch.batch_code, limit: 500 }),
    ...(await Promise.all(packBatches.map((packBatch) => searchEvents({ entityType: 'PACK_BATCH', entityId: packBatch.code, limit: 50 })))).flat(),
  ].sort((a, b) => a.id - b.id)

  res.json({
    batch: {
      code: batch.batch_code,
      quantityKg: batch.quantity_kg,
      honeyType: batch.honey_type,
      harvestDate: batch.harvest_date,
      status: batch.status,
      hiveCode: batch.hive_code,
      orgId: batch.org_id,
      orgName: batch.org_name,
      orgCode: batch.org_code,
    },
    capacity: await batchCapacity(batch),
    packBatches,
    events,
  })
})

// ------------------------------------------------------ regional performance
// KVIC head: one row per state. State officer: one row per region of the state,
// including how quickly the regional officers work through their queues.
router.get('/analytics/regions', requireRole(ROLES.STATE, ROLES.HEAD), async (req, res) => {
  const byState = req.user.role === ROLES.HEAD
  const group = byState ? 'o.state' : 'o.region'
  const scope = orgScope(req.user)
  const month = currentMonth()

  const grouped = async (sql, ...extra) => new Map(
    (await db.prepare(sql.replaceAll('{group}', group).replaceAll('{scope}', scope.sql))
      .all(...extra, ...scope.params))
      .map((row) => [row.name, row]),
  )

  const orgs = await grouped(`
    SELECT {group} AS name, COUNT(*) AS organizations,
      COALESCE(SUM(CASE WHEN o.status = 'APPROVED' THEN 1 ELSE 0 END), 0) AS approved,
      COALESCE(SUM(CASE WHEN o.status = 'PENDING_APPROVAL' THEN 1 ELSE 0 END), 0) AS pending,
      AVG(CASE WHEN o.status != 'PENDING_APPROVAL' AND o.reviewed_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (o.reviewed_at::timestamp - o.created_at::timestamp)) / 3600 END) AS avg_approval_hours
    FROM organizations o WHERE 1 = 1 {scope} GROUP BY {group}
  `)
  const honey = await grouped(`
    SELECT {group} AS name, COALESCE(SUM(b.quantity_kg), 0) AS kg
    FROM batches b JOIN organizations o ON o.id = b.org_id WHERE 1 = 1 {scope} GROUP BY {group}
  `)
  const bottles = await grouped(`
    SELECT {group} AS name, COUNT(*) AS count FROM packs p
    JOIN pack_batches pb ON pb.id = p.pack_batch_id
    JOIN batches b ON b.id = pb.batch_id
    JOIN organizations o ON o.id = b.org_id WHERE 1 = 1 {scope} GROUP BY {group}
  `)
  const labs = await grouped(`
    SELECT {group} AS name, COALESCE(SUM(CASE WHEN r.status = 'VERIFIED' THEN 1 ELSE 0 END), 0) AS verified,
      COALESCE(SUM(CASE WHEN r.status = 'PENDING' THEN 1 ELSE 0 END), 0) AS pending,
      AVG(CASE WHEN r.status != 'PENDING' AND r.reviewed_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (r.reviewed_at::timestamp - r.created_at::timestamp)) / 3600 END) AS avg_hours
    FROM lab_reviews r JOIN organizations o ON o.id = r.org_id WHERE 1 = 1 {scope} GROUP BY {group}
  `)
  const income = await grouped(`
    SELECT {group} AS name, COALESCE(SUM(m.income_inr), 0) AS income
    FROM monthly_reports m JOIN organizations o ON o.id = m.org_id
    WHERE m.month = ? {scope} GROUP BY {group}
  `, month)

  const officers = await db.prepare(`
    SELECT u.id, u.name, u.role, u.state, u.region, u.active,
      (SELECT COUNT(*) FROM audit_log a WHERE a.actor_user_id = u.id AND a.action IN ('ORG_DECISION', 'LAB_DECISION')) AS decisions
    FROM users u
    WHERE u.role IN ('STATE_OFFICER', 'REGIONAL_OFFICER')
      ${byState ? '' : 'AND u.state = ?'}
  `).all(...(byState ? [] : [req.user.state]))

  const names = [...new Set([...orgs.keys()])].sort()
  const rows = names.map((name) => {
    const own = officers.filter((officer) => (byState
      ? officer.state === name && officer.role === ROLES.STATE
      : officer.region === name))

    return {
      name,
      organizations: orgs.get(name).organizations,
      approved: orgs.get(name).approved,
      pending: orgs.get(name).pending,
      honeyKg: honey.get(name)?.kg || 0,
      bottles: bottles.get(name)?.count || 0,
      labsVerified: labs.get(name)?.verified || 0,
      labsPending: labs.get(name)?.pending || 0,
      avgApprovalHours: orgs.get(name).avg_approval_hours,
      avgLabHours: labs.get(name)?.avg_hours ?? null,
      monthIncomeInr: income.get(name)?.income || 0,
      officers: own.map((officer) => ({ id: officer.id, name: officer.name, role: officer.role, active: Boolean(officer.active), decisions: officer.decisions })),
    }
  })

  res.json({ level: byState ? 'state' : 'region', rows })
})

// ---------------------------------------------------------------- blockchain
router.get('/chain/summary', async (req, res) => {
  res.json({ ...await getChainSummary(), integrity: await validateBlockchain() })
})

router.post('/chain/validate', async (req, res) => {
  res.json(await validateBlockchain())
})

router.get('/chain/blocks', async (req, res) => {
  const before = req.query.before === undefined ? undefined : Number(req.query.before)
  res.json(await listBlocks({ before, limit: toInt(req.query.limit, 25, 500) }))
})

router.get('/chain/blocks/:height', async (req, res) => {
  const block = await getBlock(Number(req.params.height))
  if (!block) return res.status(404).json({ message: 'Block not found' })
  res.json(block)
})

router.get('/chain/events', async (req, res) => {
  res.json(await searchEvents({
    entityType: String(req.query.entityType || '').trim() || undefined,
    entityId: String(req.query.entityId || '').trim() || undefined,
    orgId: req.query.orgId ? Number(req.query.orgId) : undefined,
    limit: toInt(req.query.limit, 100, 500),
  }))
})

// ------------------------------------------------------------------ officers
router.get('/officers', requireRole(ROLES.HEAD, ROLES.STATE), async (req, res) => {
  const officers = req.user.role === ROLES.HEAD
    ? await db.prepare(`SELECT * FROM users WHERE role IN ('STATE_OFFICER', 'REGIONAL_OFFICER') ORDER BY role DESC, state, region`).all()
    : await db.prepare(`SELECT * FROM users WHERE role = 'REGIONAL_OFFICER' AND state = ? ORDER BY region`).all(req.user.state)

  const activity = await db.prepare(`
    SELECT actor_user_id,
      SUM(CASE WHEN action IN ('ORG_DECISION', 'LAB_DECISION') THEN 1 ELSE 0 END) AS decisions,
      MAX(created_at) AS last_action_at
    FROM audit_log GROUP BY actor_user_id
  `).all()
  const activityByUser = new Map(activity.map((row) => [row.actor_user_id, row]))

  res.json(await Promise.all(officers.map(async (officer) => ({
    id: officer.id,
    username: officer.username,
    name: officer.name,
    role: officer.role,
    state: officer.state,
    region: officer.region,
    active: Boolean(officer.active),
    createdAt: officer.created_at,
    lastLoginAt: officer.last_login_at,
    decisions: activityByUser.get(officer.id)?.decisions || 0,
    lastActionAt: activityByUser.get(officer.id)?.last_action_at || null,
    ...await pendingCounts(officer),
  }))))
})

router.post('/officers', requireRole(ROLES.HEAD), async (req, res) => {
  const { name, username, password, role, state, region } = req.body

  if (![ROLES.STATE, ROLES.REGIONAL].includes(role)) {
    return res.status(400).json({ message: 'Role must be STATE_OFFICER or REGIONAL_OFFICER' })
  }

  if (!String(name || '').trim() || !String(username || '').trim()) {
    return res.status(400).json({ message: 'Name and username are required' })
  }

  if (String(password || '').length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters' })
  }

  if (!isValidJurisdiction(state, role === ROLES.REGIONAL ? region : null) || (role === ROLES.REGIONAL && !region)) {
    return res.status(400).json({ message: role === ROLES.REGIONAL ? 'Choose a state and region' : 'Choose a state' })
  }

  try {
    const result = await db.prepare(`
      INSERT INTO users (username, password, name, role, state, region) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      String(username).trim(),
      bcrypt.hashSync(password, 10),
      String(name).trim(),
      role,
      state,
      role === ROLES.REGIONAL ? region : null,
    )

    await recordAudit(req.user, 'OFFICER_CREATED', 'USER', result.lastInsertRowid, {
      username: String(username).trim(),
      role,
      state,
      region: role === ROLES.REGIONAL ? region : null,
    })

    res.status(201).json({ id: result.lastInsertRowid })
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Username already exists' })
    }

    throw error
  }
})

router.patch('/officers/:id', requireRole(ROLES.HEAD), async (req, res) => {
  const officer = await db.prepare(`
    SELECT * FROM users WHERE id = ? AND role IN ('STATE_OFFICER', 'REGIONAL_OFFICER')
  `).get(Number(req.params.id))

  if (!officer) return res.status(404).json({ message: 'Officer not found' })

  const active = req.body.active ? 1 : 0
  await db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active, officer.id)

  await recordAudit(req.user, active ? 'OFFICER_ACTIVATED' : 'OFFICER_DEACTIVATED', 'USER', officer.id, {
    username: officer.username,
  })

  res.json({ id: officer.id, active: Boolean(active) })
})

router.post('/officers/:id/reset-password', requireRole(ROLES.HEAD), async (req, res) => {
  const officer = await db.prepare(`
    SELECT * FROM users WHERE id = ? AND role IN ('STATE_OFFICER', 'REGIONAL_OFFICER')
  `).get(Number(req.params.id))

  if (!officer) return res.status(404).json({ message: 'Officer not found' })

  if (String(req.body.password || '').length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters' })
  }

  await db.prepare('UPDATE users SET password = ?, password_changed_at = ? WHERE id = ?').run(bcrypt.hashSync(req.body.password, 10), new Date().toISOString(), officer.id)
  await recordAudit(req.user, 'OFFICER_PASSWORD_RESET', 'USER', officer.id, { username: officer.username })

  res.json({ message: 'Password reset' })
})

// ------------------------------------------------------------------ activity
router.get('/activity', async (req, res) => {
  const { user } = req
  const conditions = []
  const params = []

  if (user.role === ROLES.STATE) {
    conditions.push("(a.actor_user_id = ? OR (u.role = 'REGIONAL_OFFICER' AND u.state = ?))")
    params.push(user.id, user.state)
  } else if (user.role === ROLES.REGIONAL) {
    conditions.push('a.actor_user_id = ?')
    params.push(user.id)
  }

  if (req.query.userId) {
    conditions.push('a.actor_user_id = ?')
    params.push(Number(req.query.userId))
  }

  if (req.query.kind === 'approvals') {
    conditions.push("a.action IN ('ORG_DECISION', 'LAB_DECISION')")
  }

  const rows = await db.prepare(`
    SELECT a.id, a.action, a.target_type AS targetType, a.target_id AS targetId,
      a.detail_json, a.created_at AS createdAt,
      u.id AS actorId, u.name AS actorName, u.role AS actorRole, u.state AS actorState, u.region AS actorRegion
    FROM audit_log a JOIN users u ON u.id = a.actor_user_id
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY a.id DESC LIMIT ?
  `).all(...params, toInt(req.query.limit, 60, 300))

  res.json(rows.map((row) => ({ ...row, detail: parseJson(row.detail_json), detail_json: undefined })))
})

export default router
