import { useMemo, useState } from 'react'
import { Eye, Megaphone, Send, Trash2 } from 'lucide-react'

import { api, useLive } from '../api'
import { Empty, ErrorNote, LiveBadge, Modal, PageIntro, fmtDateTime } from '../ui'

export const PRIORITY_LABELS = { NORMAL: 'Notice', IMPORTANT: 'Important', URGENT: 'Urgent' }
const RELATION_LABELS = {
  sent: 'Sent by you',
  received: 'Sent to you',
  broadcast: 'For keepers in your area',
  oversight: 'Oversight',
}

// Notice board: send announcements to keepers and other offices, and read the ones addressed to you.
export default function Notices({ user, notify }) {
  const [filter, setFilter] = useState('ALL')
  const [composing, setComposing] = useState(false)
  const list = useLive('/admin/announcements', { interval: 8000 })
  const rows = list.data || []
  const shown = filter === 'ALL' ? rows : rows.filter((row) => row.relation === filter)
  const available = ['ALL', ...['sent', 'received', 'broadcast', 'oversight'].filter((relation) => rows.some((row) => row.relation === relation))]

  async function withdraw(row) {
    if (!window.confirm(`Withdraw “${row.title}”? Readers will no longer see it.`)) return
    try {
      await api(`/admin/announcements/${row.id}`, { method: 'DELETE' })
      notify('Notice withdrawn')
      list.refresh()
    } catch (error) { notify(error.message) }
  }

  return (
    <>
      <PageIntro
        eyebrow="Governance"
        title="Notice board"
        copy={user.role === 'REGIONAL_OFFICER'
          ? 'Post notices for the keepers of your region. Only they can read them; your state office and the KVIC head see them as oversight.'
          : user.role === 'STATE_OFFICER'
            ? 'Post notices for the keepers and regional officers of your state, and read what the national office sends you.'
            : 'Send a notice to everyone, or choose exactly who: keepers, state officers, regional officers, chosen states or regions, even a single keeper.'}
        right={<>
          <LiveBadge updatedAt={list.updatedAt} error={list.error} />
          <button className="primary-button" onClick={() => setComposing(true)}><Megaphone size={17} /> New notice</button>
        </>}
      />

      <div className="tabs">
        {available.map((id) => (
          <button key={id} className={`tab ${filter === id ? 'active' : ''}`} onClick={() => setFilter(id)}>
            {id === 'ALL' ? 'All notices' : RELATION_LABELS[id]}
          </button>
        ))}
      </div>

      <section className="panel notice-panel">
        {shown.length === 0
          ? <Empty>No notices yet. Use “New notice” to post the first one.</Empty>
          : shown.map((row) => <NoticeCard key={row.id} row={row} onWithdraw={() => withdraw(row)} />)}
      </section>

      {composing && <Composer user={user} onClose={() => setComposing(false)} onDone={(message) => { setComposing(false); notify(message); list.refresh() }} />}
    </>
  )
}

export function NoticeCard({ row, onWithdraw, compact }) {
  return (
    <article className={`notice-card priority-${row.priority}`}>
      <div className="notice-top">
        <span className={`priority-chip priority-${row.priority}`}>{PRIORITY_LABELS[row.priority]}</span>
        <span className="relation-chip">{RELATION_LABELS[row.relation]}</span>
        <small>{fmtDateTime(row.createdAt)}</small>
        {!compact && row.canWithdraw && <button className="icon-button" title="Withdraw notice" onClick={onWithdraw}><Trash2 size={15} /></button>}
      </div>
      <h3>{row.title}</h3>
      <p>{row.body}</p>
      <div className="notice-meta">
        <span>From <b>{row.from}</b></span>
        <span><Eye size={13} /> Visible to: {row.audienceLabel}</span>
      </div>
    </article>
  )
}

function Chips({ options, selected, onToggle, empty }) {
  return (
    <div className="chip-row">
      {options.map((option) => (
        <button type="button" key={option} className={`pick-chip ${selected.includes(option) ? 'on' : ''}`} onClick={() => onToggle(option)}>{option}</button>
      ))}
      {options.length === 0 && <small>{empty}</small>}
    </div>
  )
}

const toggle = (list, value) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value])

function Composer({ user, onClose, onDone }) {
  const targets = useLive('/admin/announcements/targets', { interval: 600000 })
  const [form, setForm] = useState({ title: '', body: '', priority: 'NORMAL' })
  const [keepers, setKeepers] = useState(true)
  const [officers, setOfficers] = useState(user.role === 'STATE_OFFICER' ? ['REGIONAL_OFFICER'] : user.role === 'KVIC_HEAD' ? ['STATE_OFFICER', 'REGIONAL_OFFICER'] : [])
  const [states, setStates] = useState([])
  const [regions, setRegions] = useState([])
  const [picked, setPicked] = useState([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const data = targets.data
  const isHead = user.role === 'KVIC_HEAD'
  const isRegional = user.role === 'REGIONAL_OFFICER'
  const allStates = data?.states.map((state) => state.name) || []
  const regionOptions = useMemo(
    () => (data?.states || []).filter((state) => states.length === 0 || states.includes(state.name)).flatMap((state) => state.regions),
    [data, states],
  )
  const keeperList = (data?.keepers || []).filter((keeper) => `${keeper.name} ${keeper.region}`.toLowerCase().includes(search.toLowerCase()))

  const summary = (() => {
    if (picked.length) return `${picked.length} selected keeper${picked.length > 1 ? 's' : ''} only`
    const place = regions.length ? regions.join(', ') : states.length ? states.join(', ') : isRegional ? user.region : isHead ? 'everywhere' : user.state
    const parts = []
    if (keepers) parts.push(`keepers (${place})`)
    if (officers.includes('STATE_OFFICER')) parts.push(`state officers (${regions.length ? 'of those regions' : place})`)
    if (officers.includes('REGIONAL_OFFICER')) parts.push(`regional officers (${place})`)
    return parts.length ? parts.join(' + ') : 'nobody yet'
  })()

  const keepersHidden = !keepers && picked.length === 0

  async function submit(event) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const result = await api('/admin/announcements', {
        method: 'POST',
        body: { ...form, audience: { keepers, officers, states, regions, orgIds: picked } },
      })
      onDone(`Notice sent to ${result.audienceLabel}`)
    } catch (submitError) {
      setError(submitError.message)
      setBusy(false)
    }
  }

  return (
    <Modal title="New notice" eyebrow="Notice board" onClose={onClose} wide>
      <form onSubmit={submit}>
        <label className="field">Title<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required minLength={3} maxLength={120} placeholder="e.g. Honey testing camp on 28 September" /></label>
        <label className="field">Message<textarea value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} required minLength={5} maxLength={1500} rows={4} /></label>
        <label className="field">Priority
          <select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>
            <option value="NORMAL">Notice</option><option value="IMPORTANT">Important</option><option value="URGENT">Urgent</option>
          </select>
        </label>

        <p className="section-title" style={{ marginTop: 18 }}>Who should read it?</p>

        {isRegional ? (
          <p className="note">Keepers of <b>{user.region}</b>. Nobody from other regions can read it. Your state office and the KVIC head can see it as oversight.</p>
        ) : (
          <div className="audience-box">
            <label className="check-line"><input type="checkbox" checked={keepers} onChange={(event) => setKeepers(event.target.checked)} /> <span><b>Keepers</b> (beekeepers and food businesses)</span></label>
            {data?.officerTargets.includes('STATE_OFFICER') && (
              <label className="check-line"><input type="checkbox" checked={officers.includes('STATE_OFFICER')} onChange={() => setOfficers(toggle(officers, 'STATE_OFFICER'))} /> <span><b>State officers</b></span></label>
            )}
            {data?.officerTargets.includes('REGIONAL_OFFICER') && (
              <label className="check-line"><input type="checkbox" checked={officers.includes('REGIONAL_OFFICER')} onChange={() => setOfficers(toggle(officers, 'REGIONAL_OFFICER'))} /> <span><b>Regional officers</b></span></label>
            )}
          </div>
        )}

        {isHead && (
          <>
            <p className="field-label">Limit to states <small>(none selected = all states)</small></p>
            <Chips options={allStates} selected={states} onToggle={(state) => { setStates(toggle(states, state)); setRegions([]) }} empty="Loading…" />
          </>
        )}
        {!isRegional && (
          <>
            <p className="field-label">Limit to regions <small>(none selected = every region{isHead ? ' in the chosen states' : ' of your state'})</small></p>
            <Chips options={regionOptions} selected={regions} onToggle={(region) => setRegions(toggle(regions, region))} empty="Loading…" />
          </>
        )}

        <p className="field-label">Or send only to specific keepers <small>({picked.length} selected)</small></p>
        <input className="closure-ref" placeholder="Search keepers by name or region" value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="keeper-pick">
          {keeperList.length === 0 && <small>No approved keepers to choose from.</small>}
          {keeperList.map((keeper) => (
            <label key={keeper.id} className="check-line"><input type="checkbox" checked={picked.includes(keeper.id)} onChange={() => setPicked(toggle(picked, keeper.id))} /> <span>{keeper.name} <small>· {keeper.region}, {keeper.state}</small></span></label>
          ))}
        </div>

        <div className="audience-summary">
          <Eye size={16} /> Will be visible to: <b>{summary}</b>
          {keepersHidden && <span> · keepers will not see this</span>}
        </div>

        <ErrorNote>{error}</ErrorNote>
        <div className="button-row"><button className="primary-button" disabled={busy}><Send size={16} /> Send notice</button><button type="button" className="secondary-button" onClick={onClose}>Cancel</button></div>
      </form>
    </Modal>
  )
}
