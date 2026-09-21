import db from '../database/database.js'
import { ROLES } from './access.js'

// Help desk tickets. A keeper opens a ticket and can text only their REGIONAL officer, who
// owns the conversation and is the only one who can close it. The regional officer can hand
// the ticket to the STATE officer at once, or ask to take it to the CENTRAL office, which
// happens only if the state officer approves. State and central officers write internal notes
// that keepers never see; the keeper stays in touch with the regional officer.

export class TicketError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

const LEVELS = ['REGIONAL', 'STATE', 'CENTRAL']
const LEVEL_LABEL = { REGIONAL: 'Regional officer', STATE: 'State office', CENTRAL: 'Central office' }
const MAX_OPEN_PER_KEEPER = 5
const now = () => new Date().toISOString()
const text = (value, max) => String(value ?? '').trim().slice(0, max)

const orgOf = async (ticket) => await db.prepare('SELECT id, legal_name, organization_code, state, region FROM organizations WHERE id = ?').get(ticket.org_id)
const pendingCentral = async (ticketId) => await db.prepare("SELECT * FROM ticket_escalations WHERE ticket_id = ? AND target = 'CENTRAL' AND status = 'PENDING'").get(ticketId)

// ---------------------------------------------------------------- who may see what
export async function canSee(user, ticket, knownOrg) {
  const org = knownOrg ?? await orgOf(ticket)
  if (user.role === ROLES.REGIONAL) return org.state === user.state && org.region === user.region
  if (user.role === ROLES.STATE) return org.state === user.state && (ticket.level !== 'REGIONAL' || Boolean(await pendingCentral(ticket.id)))
  if (user.role === ROLES.HEAD) return ticket.level === 'CENTRAL'
  return false
}

const isOwner = async (user, ticket, knownOrg) => {
  const org = knownOrg ?? await orgOf(ticket)
  return user.role === ROLES.REGIONAL && org.state === user.state && org.region === user.region
}

// ---------------------------------------------------------------- writing
async function addMessage(ticketId, { senderType, senderId = null, senderName = null, body, visibility = 'PUBLIC', kind = 'MESSAGE' }) {
  const id = (await db.prepare(`
    INSERT INTO ticket_messages (ticket_id, sender_type, sender_id, sender_name, body, visibility, kind, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(ticketId, senderType, senderId, senderName, body, visibility, kind, now())).lastInsertRowid
  await db.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run(now(), ticketId)
  return id
}

const event = async (ticketId, body, visibility = 'PUBLIC') => await addMessage(ticketId, { senderType: 'SYSTEM', body, visibility, kind: 'EVENT' })

export async function openTicket({ org, user, subject, message }) {
  const title = text(subject, 120)
  const first = text(message, 1500)
  if (title.length < 3) throw new TicketError('Add a short subject (at least 3 characters)')
  if (first.length < 5) throw new TicketError('Describe your question (at least 5 characters)')

  const open = (await db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE org_id = ? AND status = 'OPEN'").get(org.id)).n
  if (open >= MAX_OPEN_PER_KEEPER) throw new TicketError(`You already have ${MAX_OPEN_PER_KEEPER} open tickets. Wait for your regional officer to close one first.`, 429)

  return await db.transaction(async () => {
    const id = (await db.prepare('INSERT INTO tickets (ticket_code, org_id, user_id, subject, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('PENDING', org.id, user.id, title, now(), now())).lastInsertRowid
    const code = `TKT-${new Date().getFullYear()}-${String(id).padStart(4, '0')}`
    await db.prepare('UPDATE tickets SET ticket_code = ? WHERE id = ?').run(code, id)
    await addMessage(id, { senderType: 'KEEPER', senderId: user.id, senderName: user.name, body: first })
    return { id, code }
  })()
}

export async function keeperReply({ ticket, user, body }) {
  const message = text(body, 1500)
  if (ticket.status !== 'OPEN') throw new TicketError('This ticket was closed by your regional officer. Open a new ticket if you still need help.', 409)
  if (message.length < 1) throw new TicketError('Write your message')
  return await addMessage(ticket.id, { senderType: 'KEEPER', senderId: user.id, senderName: user.name, body: message })
}

// Regional officers reply to the keeper; every officer who can see the ticket may leave an internal note.
export async function officerMessage({ ticket, user, body, internal }) {
  const org = await orgOf(ticket)
  if (!await canSee(user, ticket, org)) throw new TicketError('Ticket not found in your jurisdiction', 404)
  if (ticket.status !== 'OPEN') throw new TicketError('This ticket is closed. Reopen it first.', 409)

  const message = text(body, 1500)
  if (message.length < 1) throw new TicketError('Write your message')

  if (!internal && !await isOwner(user, ticket, org)) {
    throw new TicketError('Only the keeper’s regional officer can write to the keeper. Leave an internal note for the regional officer instead.', 403)
  }

  return await addMessage(ticket.id, {
    senderType: user.role, senderId: user.id, senderName: user.name, body: message, visibility: internal ? 'INTERNAL' : 'PUBLIC',
  })
}

async function requireOwner(user, ticket) {
  const org = await orgOf(ticket)
  if (!await isOwner(user, ticket, org)) throw new TicketError('Only the keeper’s regional officer can do this', 403)
  return org
}

// Regional officer hands the ticket to the state office right away, or asks for the central office.
export async function escalate({ ticket, user, target, reason }) {
  await requireOwner(user, ticket)
  if (ticket.status !== 'OPEN') throw new TicketError('Only an open ticket can be escalated', 409)

  const why = text(reason, 400)
  if (why.length < 5) throw new TicketError('Explain why you are escalating it (at least 5 characters)')

  if (target === 'STATE') {
    if (ticket.level !== 'REGIONAL') throw new TicketError('This ticket is already with the state office', 409)
    await db.transaction(async () => {
      await db.prepare("INSERT INTO ticket_escalations (ticket_id, target, reason, requested_by, status, created_at) VALUES (?, 'STATE', ?, ?, 'DONE', ?)").run(ticket.id, why, user.id, now())
      await db.prepare("UPDATE tickets SET level = 'STATE' WHERE id = ?").run(ticket.id)
      await addMessage(ticket.id, { senderType: 'SYSTEM', body: `Escalated to the state office by ${user.name}: ${why}`, visibility: 'INTERNAL', kind: 'EVENT' })
      await event(ticket.id, 'Your regional officer asked the state office to look into this. You can keep writing to your regional officer.')
    })()
    return { level: 'STATE' }
  }

  if (target === 'CENTRAL') {
    if (ticket.level === 'CENTRAL') throw new TicketError('This ticket is already with the central office', 409)
    if (await pendingCentral(ticket.id)) throw new TicketError('A request to the central office is already waiting for the state officer', 409)
    await db.transaction(async () => {
      await db.prepare("INSERT INTO ticket_escalations (ticket_id, target, reason, requested_by, status, created_at) VALUES (?, 'CENTRAL', ?, ?, 'PENDING', ?)").run(ticket.id, why, user.id, now())
      await addMessage(ticket.id, { senderType: 'SYSTEM', body: `${user.name} asked to take this urgent ticket to the central office: ${why}. Waiting for the state officer's approval.`, visibility: 'INTERNAL', kind: 'EVENT' })
    })()
    return { level: ticket.level, pendingApproval: true }
  }

  throw new TicketError('Choose the state office or the central office')
}

// The state officer approves or declines taking a ticket to the central office.
export async function decideCentral({ ticket, user, decision, note }) {
  const org = await orgOf(ticket)
  if (user.role !== ROLES.STATE || org.state !== user.state) throw new TicketError('Only the state officer of this state can decide this', 403)

  const request = await pendingCentral(ticket.id)
  if (!request) throw new TicketError('There is no request waiting for approval', 409)
  if (!['APPROVED', 'DECLINED'].includes(decision)) throw new TicketError('Decision must be APPROVED or DECLINED')

  const why = text(note, 300)
  if (decision === 'DECLINED' && why.length < 3) throw new TicketError('Say why you are declining (at least 3 characters)')

  await db.transaction(async () => {
    await db.prepare('UPDATE ticket_escalations SET status = ?, decided_by = ?, decision_note = ?, decided_at = ? WHERE id = ?').run(decision, user.id, why || null, now(), request.id)

    if (decision === 'APPROVED') {
      await db.prepare("UPDATE tickets SET level = 'CENTRAL' WHERE id = ?").run(ticket.id)
      await addMessage(ticket.id, { senderType: 'SYSTEM', body: `${user.name} approved and sent this ticket to the central office.${why ? ` Note: ${why}` : ''}`, visibility: 'INTERNAL', kind: 'EVENT' })
      await event(ticket.id, 'This ticket has been marked urgent and shared with the central office. Keep writing to your regional officer.')
    } else {
      await addMessage(ticket.id, { senderType: 'SYSTEM', body: `${user.name} declined the request to go to the central office: ${why}`, visibility: 'INTERNAL', kind: 'EVENT' })
    }
  })()

  return { decision }
}

// State officers hand a ticket back to the regional officer; the head hands a central ticket back to the state office.
export async function returnTicket({ ticket, user, note }) {
  const org = await orgOf(ticket)
  if (!await canSee(user, ticket, org)) throw new TicketError('Ticket not found in your jurisdiction', 404)

  const from = ticket.level
  let next = null
  if (user.role === ROLES.STATE && from !== 'REGIONAL') next = 'REGIONAL'
  if (user.role === ROLES.HEAD && from === 'CENTRAL') next = 'STATE'
  if (!next) throw new TicketError('This ticket cannot be handed back from here', 409)

  const why = text(note, 300)
  if (why.length < 3) throw new TicketError('Add a note for the officer you hand it back to (at least 3 characters)')

  await db.transaction(async () => {
    await db.prepare('UPDATE tickets SET level = ? WHERE id = ?').run(next, ticket.id)
    await addMessage(ticket.id, { senderType: user.role, senderId: user.id, senderName: user.name, body: `Handed back to the ${LEVEL_LABEL[next].toLowerCase()}: ${why}`, visibility: 'INTERNAL', kind: 'EVENT' })
    if (next === 'REGIONAL') await event(ticket.id, 'The state office has looked at this and handed it back to your regional officer.')
  })()

  return { level: next }
}

// Only the regional officer closes (or reopens) a ticket.
export async function setStatus({ ticket, user, status, note }) {
  await requireOwner(user, ticket)
  if (ticket.status === status) throw new TicketError(`The ticket is already ${status.toLowerCase()}`, 409)

  await db.transaction(async () => {
    await db.prepare('UPDATE tickets SET status = ?, closed_at = ?, closed_by = ? WHERE id = ?').run(status, status === 'CLOSED' ? now() : null, status === 'CLOSED' ? user.id : null, ticket.id)
    const extra = text(note, 200)
    await event(ticket.id, status === 'CLOSED' ? `Your regional officer closed this ticket.${extra ? ` ${extra}` : ''}` : 'Your regional officer reopened this ticket.')
  })()
}

// ---------------------------------------------------------------- reading
const ticketRow = async (id) => await db.prepare('SELECT * FROM tickets WHERE id = ?').get(Number(id))
export const getTicket = ticketRow

async function lastMessage(ticketId, publicOnly) {
  return await db.prepare(`SELECT * FROM ticket_messages WHERE ticket_id = ? AND kind = 'MESSAGE' ${publicOnly ? "AND visibility = 'PUBLIC'" : ''} ORDER BY id DESC LIMIT 1`).get(ticketId)
}

async function summary(ticket, org, { forKeeper, viewer }) {
  const last = await lastMessage(ticket.id, forKeeper)
  const central = await pendingCentral(ticket.id)
  const base = {
    id: ticket.id,
    code: ticket.ticket_code,
    subject: ticket.subject,
    status: ticket.status,
    level: ticket.level,
    levelLabel: LEVEL_LABEL[ticket.level],
    createdAt: ticket.created_at,
    updatedAt: ticket.updated_at,
    closedAt: ticket.closed_at,
    lastMessage: last ? { body: last.body.slice(0, 140), from: last.sender_type, at: last.created_at } : null,
  }

  if (forKeeper) {
    return { ...base, unread: Boolean(last && last.sender_type !== 'KEEPER' && last.id > ticket.keeper_seen_id) }
  }

  return {
    ...base,
    orgId: org.id,
    orgName: org.legal_name,
    orgCode: org.organization_code,
    state: org.state,
    region: org.region,
    pendingCentral: Boolean(central),
    awaitingReply: ticket.status === 'OPEN' && await isOwner(viewer, ticket, org) && Boolean(last && last.sender_type === 'KEEPER'),
    awaitingApproval: Boolean(central) && viewer.role === ROLES.STATE,
    canClose: await isOwner(viewer, ticket, org),
  }
}

export async function keeperTickets(org) {
  return await Promise.all((await db.prepare('SELECT * FROM tickets WHERE org_id = ? ORDER BY updated_at DESC, id DESC LIMIT 100').all(org.id))
    .map(async (ticket) => await summary(ticket, org, { forKeeper: true })))
}

export async function keeperThread(org, id) {
  const ticket = await db.prepare('SELECT * FROM tickets WHERE id = ? AND org_id = ?').get(Number(id), org.id)
  if (!ticket) return null

  const messages = await db.prepare("SELECT * FROM ticket_messages WHERE ticket_id = ? AND visibility = 'PUBLIC' ORDER BY id ASC").all(ticket.id)
  if (messages.length) await db.prepare('UPDATE tickets SET keeper_seen_id = ? WHERE id = ?').run(messages[messages.length - 1].id, ticket.id)

  return { ...await summary({ ...ticket, keeper_seen_id: messages.length ? messages[messages.length - 1].id : ticket.keeper_seen_id }, org, { forKeeper: true }), messages: messages.map(messageView) }
}

const messageView = (row) => ({ id: row.id, from: row.sender_type, name: row.sender_name, body: row.body, internal: row.visibility === 'INTERNAL', event: row.kind === 'EVENT', at: row.created_at })

export async function officerTickets(user, filter = 'ALL') {
  const orgs = new Map((await db.prepare('SELECT id, legal_name, organization_code, state, region FROM organizations').all()).map((org) => [org.id, org]))
  const rows = await db.prepare('SELECT * FROM tickets ORDER BY (status = \'OPEN\') DESC, updated_at DESC LIMIT 400').all()

  const visible = []
  for (const ticket of rows) if (await canSee(user, ticket, orgs.get(ticket.org_id))) visible.push(ticket)

  return (await Promise.all(visible.map(async (ticket) => await summary(ticket, orgs.get(ticket.org_id), { forKeeper: false, viewer: user }))))
    .filter((row) => (filter === 'OPEN' ? row.status === 'OPEN' : filter === 'CLOSED' ? row.status === 'CLOSED' : filter === 'ESCALATED' ? row.level !== 'REGIONAL' || row.pendingCentral : true))
}

export async function officerThread(user, id) {
  const ticket = await ticketRow(id)
  if (!ticket) return null
  const org = await orgOf(ticket)
  if (!await canSee(user, ticket, org)) return null

  const messages = await db.prepare('SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY id ASC').all(ticket.id)
  if (await isOwner(user, ticket, org) && messages.length) await db.prepare('UPDATE tickets SET officer_seen_id = ? WHERE id = ?').run(messages[messages.length - 1].id, ticket.id)

  const escalations = (await db.prepare(`
    SELECT e.*, u.name AS requested_by_name, d.name AS decided_by_name FROM ticket_escalations e
    LEFT JOIN users u ON u.id = e.requested_by LEFT JOIN users d ON d.id = e.decided_by WHERE e.ticket_id = ? ORDER BY e.id ASC
  `).all(ticket.id)).map((row) => ({ id: row.id, target: row.target, reason: row.reason, status: row.status, requestedBy: row.requested_by_name, decidedBy: row.decided_by_name, decisionNote: row.decision_note, at: row.created_at }))

  const keeper = await db.prepare('SELECT name FROM users WHERE id = ?').get(ticket.user_id)

  return {
    ...await summary(ticket, org, { forKeeper: false, viewer: user }),
    keeperName: keeper?.name,
    messages: messages.map(messageView),
    escalations,
    permissions: {
      reply: await isOwner(user, ticket, org) && ticket.status === 'OPEN',
      note: ticket.status === 'OPEN',
      escalateState: await isOwner(user, ticket, org) && ticket.status === 'OPEN' && ticket.level === 'REGIONAL',
      requestCentral: await isOwner(user, ticket, org) && ticket.status === 'OPEN' && ticket.level !== 'CENTRAL' && !await pendingCentral(ticket.id),
      decide: user.role === ROLES.STATE && Boolean(await pendingCentral(ticket.id)),
      handBack: (user.role === ROLES.STATE && ticket.level !== 'REGIONAL') || (user.role === ROLES.HEAD && ticket.level === 'CENTRAL'),
      close: await isOwner(user, ticket, org) && ticket.status === 'OPEN',
      reopen: await isOwner(user, ticket, org) && ticket.status === 'CLOSED',
    },
  }
}

// Numbers for badges and the bell.
export async function ticketAlerts(user) {
  const rows = await officerTickets(user, 'OPEN')
  return {
    needReply: rows.filter((row) => row.awaitingReply).length,
    awaitingApproval: rows.filter((row) => row.awaitingApproval).length,
    escalated: user.role === ROLES.REGIONAL ? 0 : rows.length,
  }
}

// Keeper notifications: the latest officer reply of each ticket, and closures.
export async function keeperTicketNotices(org) {
  const tickets = await db.prepare('SELECT * FROM tickets WHERE org_id = ? ORDER BY updated_at DESC LIMIT 15').all(org.id)
  const groups = await Promise.all(tickets.map(async (ticket) => {
    const last = await db.prepare("SELECT * FROM ticket_messages WHERE ticket_id = ? AND visibility = 'PUBLIC' ORDER BY id DESC LIMIT 1").get(ticket.id)
    if (!last || last.sender_type === 'KEEPER') return []
    return [{
      id: `ticket-${ticket.id}-${last.id}`,
      type: 'support',
      title: last.kind === 'EVENT' ? `${ticket.ticket_code}: ${ticket.subject}` : `New reply on ${ticket.ticket_code}: ${ticket.subject}`,
      message: last.body,
      time: last.created_at,
    }]
  }))
  return groups.flat()
}
