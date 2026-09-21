import db from '../database/database.js'
import { REGIONS } from '../config/regions.js'
import { ROLES } from './access.js'

// Notice board. Who can read a notice depends on who sent it and who it is for:
//  - Regional officer  -> keepers of their own region only. The state officer of that
//    state and the KVIC head can read it as oversight of their regional officers.
//  - State officer     -> keepers and/or regional officers of their state.
//  - KVIC head         -> everyone, or any mix of: all keepers, state officers, regional
//    officers, chosen states, chosen regions, or individual keepers. A notice addressed
//    to officers only is never visible to keepers.
// Regional officers also see, in their notifications, what state and national offices
// sent to the keepers of their region.

export class AnnouncementError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

export const PRIORITIES = ['NORMAL', 'IMPORTANT', 'URGENT']
const OFFICER_TARGETS = [ROLES.STATE, ROLES.REGIONAL]
const ALL_REGIONS = Object.values(REGIONS).flat()
const stateOf = (region) => Object.keys(REGIONS).find((state) => REGIONS[state].includes(region))
const list = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string' || typeof item === 'number') : [])
const has = (array, value) => Boolean(array?.length) && array.includes(value)

async function orgInfo() {
  return new Map((await db.prepare('SELECT id, legal_name, state, region, status FROM organizations').all()).map((row) => [row.id, row]))
}

// Does this notice reach keepers of the given state/region (or a given organisation)?
function reachesKeeper(audience, org) {
  if (!audience.keepers) return false
  if (audience.orgIds?.length) return audience.orgIds.includes(org.id)
  if (audience.regions?.length) return audience.regions.includes(org.region)
  if (audience.states?.length) return audience.states.includes(org.state)
  return true
}

function reachesOfficer(audience, viewer) {
  if (!audience.officers?.includes(viewer.role)) return false
  if (viewer.role === ROLES.HEAD) return true

  if (viewer.role === ROLES.REGIONAL) {
    if (audience.regions?.length) return audience.regions.includes(viewer.region)
    if (audience.states?.length) return audience.states.includes(viewer.state)
    return true
  }

  if (audience.states?.length) return audience.states.includes(viewer.state)
  if (audience.regions?.length) return audience.regions.some((region) => stateOf(region) === viewer.state)
  return true
}

function keepersInside(audience, orgs, predicate) {
  if (!audience.keepers) return false
  if (audience.orgIds?.length) return audience.orgIds.some((id) => orgs.get(id) && predicate(orgs.get(id)))
  if (audience.regions?.length) return audience.regions.some((region) => predicate({ state: stateOf(region), region }))
  if (audience.states?.length) return audience.states.some((state) => predicate({ state, region: null }) || REGIONS[state]?.some((region) => predicate({ state, region })))
  return true
}

// 'received' | 'sent' | 'broadcast' (sent to keepers in your area) | 'oversight' (a lower office sent it) | null
export function relationFor(row, audience, viewer, orgs) {
  if (viewer.role === ROLES.BEEKEEPER) return reachesKeeper(audience, viewer.org) ? 'received' : null

  if (row.author_id === viewer.id) return 'sent'
  if (reachesOfficer(audience, viewer)) return 'received'
  if (viewer.role === ROLES.HEAD) return 'oversight'

  if (viewer.role === ROLES.STATE) {
    if (row.author_role === ROLES.REGIONAL && row.author_state === viewer.state) return 'oversight'
    if (row.author_role !== ROLES.REGIONAL && keepersInside(audience, orgs, (org) => org.state === viewer.state)) return 'broadcast'
    return null
  }

  if (row.author_role !== ROLES.REGIONAL && keepersInside(audience, orgs, (org) => org.state === viewer.state && org.region === viewer.region)) return 'broadcast'
  return null
}

export function audienceLabel(audience, orgs) {
  const parts = []

  if (audience.orgIds?.length) {
    const names = audience.orgIds.map((id) => orgs.get(id)?.legal_name).filter(Boolean)
    parts.push(names.length <= 2 ? names.join(' and ') : `${names.length} selected keepers`)
  } else if (audience.keepers) {
    const place = audience.regions?.length ? audience.regions.join(', ') : audience.states?.length ? audience.states.join(', ') : ''
    parts.push(place ? `Keepers in ${place}` : 'All keepers')
  }

  if (audience.officers?.length) {
    const roles = audience.officers.map((role) => (role === ROLES.STATE ? 'state officers' : 'regional officers')).join(' and ')
    const place = audience.regions?.length ? ` (${audience.regions.join(', ')})` : audience.states?.length ? ` (${audience.states.join(', ')})` : ''
    parts.push(`${roles.charAt(0).toUpperCase()}${roles.slice(1)}${place}`)
  }

  return parts.join(' + ') || 'No one'
}

function view(row, audience, relation, viewer, orgs) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    priority: row.priority,
    createdAt: row.created_at,
    relation,
    author: { name: row.author_name, role: row.author_role, state: row.author_state, region: row.author_region },
    from: row.author_role === ROLES.HEAD ? 'KVIC national office' : row.author_role === ROLES.STATE ? `State office, ${row.author_state}` : `Regional office, ${row.author_region}`,
    audienceLabel: audienceLabel(audience, orgs),
    forKeepers: Boolean(audience.keepers),
    canWithdraw: viewer.role !== ROLES.BEEKEEPER && (row.author_id === viewer.id || viewer.role === ROLES.HEAD),
  }
}

// Notices this viewer may read, newest first. A keeper viewer is { role: 'BEEKEEPER', org }.
export async function visibleAnnouncements(viewer, { limit = 100 } = {}) {
  const orgs = await orgInfo()
  const rows = await db.prepare(`
    SELECT a.*, u.name AS author_name FROM announcements a
    JOIN users u ON u.id = a.author_id
    WHERE a.withdrawn_at IS NULL ORDER BY a.id DESC LIMIT 400
  `).all()

  const out = []
  for (const row of rows) {
    const audience = JSON.parse(row.audience_json)
    const relation = relationFor(row, audience, viewer, orgs)
    if (relation) out.push(view(row, audience, relation, viewer, orgs))
    if (out.length >= limit) break
  }
  return out
}

// What each kind of officer may send to, for the composer.
export async function composerTargets(user) {
  const rows = await db.prepare(`
    SELECT o.id, o.legal_name AS name, o.state, o.region FROM organizations o
    WHERE o.status IN ('APPROVED', 'SUSPENDED') ${user.role === ROLES.HEAD ? '' : user.role === ROLES.STATE ? 'AND o.state = ?' : 'AND o.state = ? AND o.region = ?'}
    ORDER BY o.legal_name
  `).all(...(user.role === ROLES.HEAD ? [] : user.role === ROLES.STATE ? [user.state] : [user.state, user.region]))

  const states = user.role === ROLES.HEAD ? Object.keys(REGIONS) : [user.state]

  return {
    role: user.role,
    states: states.map((state) => ({ name: state, regions: user.role === ROLES.REGIONAL ? [user.region] : REGIONS[state] })),
    keepers: rows,
    officerTargets: user.role === ROLES.HEAD ? OFFICER_TARGETS : user.role === ROLES.STATE ? [ROLES.REGIONAL] : [],
  }
}

export async function createAnnouncement(user, body) {
  const title = String(body.title || '').trim().slice(0, 120)
  const message = String(body.body || '').trim().slice(0, 1500)
  const priority = PRIORITIES.includes(body.priority) ? body.priority : 'NORMAL'

  if (title.length < 3) throw new AnnouncementError('Give the notice a short title (at least 3 characters)')
  if (message.length < 5) throw new AnnouncementError('Write the notice (at least 5 characters)')

  const raw = body.audience || {}
  const orgs = await orgInfo()
  let orgIds = list(raw.orgIds).map(Number).filter((id) => orgs.has(id))
  let states = list(raw.states).filter((state) => REGIONS[state])
  let regions = list(raw.regions).filter((region) => ALL_REGIONS.includes(region))
  let officers = list(raw.officers).filter((role) => OFFICER_TARGETS.includes(role))
  let keepers = Boolean(raw.keepers)

  if (user.role === ROLES.REGIONAL) {
    officers = []
    keepers = true
    states = [user.state]
    regions = [user.region]
    if (orgIds.some((id) => orgs.get(id).region !== user.region || orgs.get(id).state !== user.state)) {
      throw new AnnouncementError('You can only address keepers of your own region', 403)
    }
  } else if (user.role === ROLES.STATE) {
    officers = officers.filter((role) => role === ROLES.REGIONAL)
    states = [user.state]
    regions = regions.filter((region) => stateOf(region) === user.state)
    if (orgIds.some((id) => orgs.get(id).state !== user.state)) {
      throw new AnnouncementError('You can only address keepers of your own state', 403)
    }
  }

  if (orgIds.length) keepers = true
  if (!keepers && officers.length === 0) throw new AnnouncementError('Choose who should receive this notice')
  if (regions.length) states = [...new Set(regions.map(stateOf))]

  const audience = { keepers, officers, states, regions, orgIds }
  const id = (await db.prepare(`
    INSERT INTO announcements (author_id, author_role, author_state, author_region, title, body, priority, audience_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(user.id, user.role, user.state || null, user.region || null, title, message, priority, JSON.stringify(audience), new Date().toISOString())).lastInsertRowid

  return { id, audienceLabel: audienceLabel(audience, orgs), title }
}

export async function withdrawAnnouncement(user, id) {
  const row = await db.prepare('SELECT * FROM announcements WHERE id = ? AND withdrawn_at IS NULL').get(Number(id))
  if (!row) throw new AnnouncementError('Notice not found', 404)
  if (row.author_id !== user.id && user.role !== ROLES.HEAD) throw new AnnouncementError('Only the sender or the KVIC head can withdraw a notice', 403)

  await db.prepare('UPDATE announcements SET withdrawn_at = ? WHERE id = ?').run(new Date().toISOString(), row.id)
  return row
}
