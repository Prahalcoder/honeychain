import { useState } from 'react'
import { BadgeCheck, FlaskConical, KeyRound, LogIn, UserCog } from 'lucide-react'

import { useLive } from '../api'
import { Empty, LiveBadge, PageIntro, ROLE_LABELS, fmtDateTime, initials } from '../ui'

const ACTION_LABELS = {
  LOGIN: ['Signed in', LogIn],
  ORG_DECISION: ['Organisation decision', BadgeCheck],
  LAB_DECISION: ['Lab result decision', FlaskConical],
  OFFICER_CREATED: ['Officer created', UserCog],
  OFFICER_ACTIVATED: ['Officer activated', UserCog],
  OFFICER_DEACTIVATED: ['Officer deactivated', UserCog],
  OFFICER_PASSWORD_RESET: ['Officer password reset', KeyRound],
  PASSWORD_CHANGED: ['Changed own password', KeyRound],
}

function describe(row) {
  const detail = row.detail || {}

  if (row.action === 'ORG_DECISION') return `${detail.decision} ${detail.orgName} (was ${detail.previousStatus})${detail.note ? ` — “${detail.note}”` : ''}`
  if (row.action === 'LAB_DECISION') return `${detail.decision} lab result ${detail.certificateReference} for batch ${row.targetId} of ${detail.orgName}${detail.note ? ` — “${detail.note}”` : ''}`
  if (row.action === 'OFFICER_CREATED') return `${detail.username} as ${ROLE_LABELS[detail.role] || detail.role} for ${detail.region ? `${detail.region}, ` : ''}${detail.state}`
  if (detail.username) return detail.username
  return ''
}

// Supervision feed: the KVIC head sees every officer, a state officer the
// regional officers in their state, a regional officer only their own actions.
export default function Activity({ user, params }) {
  const [kind, setKind] = useState('all')
  const [officerId, setOfficerId] = useState(params.userId || '')
  const feed = useLive(`/admin/activity?limit=150${kind === 'approvals' ? '&kind=approvals' : ''}${officerId ? `&userId=${officerId}` : ''}`, { interval: 5000 })
  const officers = useLive(user.role === 'REGIONAL_OFFICER' ? null : '/admin/officers', { interval: 30000 })
  const rows = feed.data || []

  return (
    <>
      <PageIntro
        eyebrow="Supervision"
        title={user.role === 'REGIONAL_OFFICER' ? 'My activity' : 'Activity & approvals'}
        copy="Every sign-in, approval and rejection, from an append-only audit log that cannot be edited."
        right={<LiveBadge updatedAt={feed.updatedAt} error={feed.error} />}
      />

      <div className="toolbar">
        <div className="chips">
          <button className={`chip ${kind === 'all' ? 'active' : ''}`} onClick={() => setKind('all')}>All activity</button>
          <button className={`chip ${kind === 'approvals' ? 'active' : ''}`} onClick={() => setKind('approvals')}>Approvals only</button>
        </div>
        {user.role !== 'REGIONAL_OFFICER' && (
          <label className="field" style={{ margin: '0 0 0 auto' }}>
            <select value={officerId} onChange={(event) => setOfficerId(event.target.value)}>
              <option value="">All officers</option>
              {(officers.data || []).map((officer) => <option key={officer.id} value={officer.id}>{officer.name}</option>)}
            </select>
          </label>
        )}
      </div>

      <section className="panel">
        {rows.length === 0 ? <Empty>No activity recorded yet.</Empty> : rows.map((row) => {
          const [label, Icon] = ACTION_LABELS[row.action] || [row.action, BadgeCheck]
          return (
            <div className="activity-row" key={row.id}>
              <div className="org-avatar green">{initials(row.actorName)}</div>
              <div><strong><Icon size={12} style={{ verticalAlign: '-1px', marginRight: 5 }} />{label}</strong><span>{row.actorName} · {ROLE_LABELS[row.actorRole]}{row.actorRegion ? ` · ${row.actorRegion}` : ''}{row.actorState ? `, ${row.actorState}` : ''}<br />{describe(row)}</span></div>
              <time>{fmtDateTime(row.createdAt)}</time>
            </div>
          )
        })}
      </section>
    </>
  )
}
