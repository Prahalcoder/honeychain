import { useState } from 'react'
import { CalendarClock, ClipboardList, Power } from 'lucide-react'

import { api, useLive } from '../api'
import { Empty, ErrorNote, LiveBadge, Modal, PageIntro, StatusPill, fmtDate, fmtDateTime, kg } from '../ui'

const RATING_LABELS = { OK: 'Satisfactory', MINOR: 'Minor issue', MAJOR: 'Major issue', NA: 'Not applicable' }
const RATING_TONES = { OK: 'ok', MINOR: 'minor', MAJOR: 'major', NA: 'na' }
const CORRECTIVE_OUTCOMES = ['CORRECTIVE_ACTION', 'RE_INSPECTION']

const isoDay = (offset = 0) => new Date(Date.now() + offset * 86400000).toLocaleDateString('en-CA')

// Same rule the server uses to suggest a grade from the checklist.
function suggestGrade(checklist) {
  const ratings = Object.values(checklist).map((entry) => entry.rating)
  const major = ratings.filter((rating) => rating === 'MAJOR').length
  const minor = ratings.filter((rating) => rating === 'MINOR').length
  if (major >= 2) return 'D'
  if (major === 1 || minor >= 3) return 'C'
  if (minor >= 1) return 'B'
  return 'A'
}

// Inspections and audits: schedule a visit (the keeper is told at least a day
// ahead), file the visit report with grade and remarks, and issue a closure
// notice when the audit warrants it.
export default function Inspections({ user, params, notify, refreshOverview }) {
  const [tab, setTab] = useState('SCHEDULED')
  const [modal, setModal] = useState(params.schedule ? { kind: 'schedule', orgId: params.schedule } : null)

  const meta = useLive('/admin/inspections/meta', { interval: 600000 })
  const list = useLive('/admin/inspections?status=ALL', { interval: 5000 })
  const orgs = useLive('/admin/organizations?status=ALL', { interval: 30000 })

  const rows = list.data || []
  const counts = { SCHEDULED: 0, COMPLETED: 0, CANCELLED: 0 }
  rows.forEach((row) => { counts[row.status] += 1 })
  const shown = tab === 'ALL' ? rows : rows.filter((row) => row.status === tab)
  const eligible = (orgs.data || []).filter((org) => ['APPROVED', 'SUSPENDED'].includes(org.status))
  const today = isoDay()

  function done(message) {
    notify(message)
    setModal(null)
    list.refresh()
    refreshOverview()
  }

  return (
    <>
      <PageIntro
        eyebrow="Governance"
        title="Inspections"
        copy="Schedule an inspection (the keeper is notified straight away and reminded the day before), record what you found on the visit, and issue a closure notice when an audit warrants it."
        right={<>
          <LiveBadge updatedAt={list.updatedAt} error={list.error} />
          <button className="primary-button" onClick={() => setModal({ kind: 'schedule' })}><CalendarClock size={17} /> Schedule inspection</button>
        </>}
      />

      <div className="tabs">
        {[['SCHEDULED', 'Scheduled'], ['COMPLETED', 'Reported'], ['CANCELLED', 'Cancelled'], ['ALL', 'All']].map(([id, label]) => (
          <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            {label} {id !== 'ALL' && counts[id] > 0 && <b>{counts[id]}</b>}
          </button>
        ))}
      </div>

      <section className="panel request-panel">
        {shown.length === 0
          ? <Empty>{tab === 'SCHEDULED' ? 'No inspections are scheduled. Use “Schedule inspection” to notify a keeper.' : 'Nothing here yet.'}</Empty>
          : shown.map((row) => <InspectionCard key={row.id} row={row} meta={meta.data} today={today} onAction={(kind) => setModal({ kind, row })} />)}
      </section>

      {modal?.kind === 'schedule' && <ScheduleModal orgs={eligible} meta={meta.data} initialOrg={modal.orgId} onClose={() => setModal(null)} onDone={() => done('Inspection scheduled. The keeper has been notified')} />}
      {modal?.kind === 'report' && meta.data && <ReportModal row={modal.row} meta={meta.data} user={user} onClose={() => setModal(null)} onDone={() => done('Inspection report filed')} />}
      {modal?.kind === 'cancel' && <CancelModal row={modal.row} onClose={() => setModal(null)} onDone={() => done('Inspection cancelled. The keeper has been told')} />}
      {modal?.kind === 'closure' && <ClosureNoticeModal row={modal.row} onClose={() => setModal(null)} onDone={() => done('Closure notice issued. Complete the formalities in the Review queue')} />}
    </>
  )
}

function GradeBadge({ grade, label }) {
  return <span className={`grade-badge grade-${grade}`} title={label}>{grade}</span>
}

function InspectionCard({ row, meta, today, onAction }) {
  const scheduled = row.status === 'SCHEDULED'
  const completed = row.status === 'COMPLETED'
  const canReport = row.scheduledDate <= today
  const gap = completed && row.chainStockKg !== null && row.physicalStockKg !== null ? Math.round((row.physicalStockKg - row.chainStockKg) * 100) / 100 : null

  return (
    <div className="req-card">
      <div className="req-top">
        <div className="org-avatar blue"><ClipboardList size={16} /></div>
        <div>
          <strong>{row.orgName}</strong>
          <span>{row.code} · {row.region}, {row.state} · {row.purposeLabel}</span>
        </div>
        {completed && <GradeBadge grade={row.grade} label={row.gradeLabel} />}
        <StatusPill status={row.status} />
      </div>

      <div className="req-body">
        <div><span>Inspection date</span><strong>{fmtDate(row.scheduledDate)}{row.scheduledTime ? ` · ${row.scheduledTime}` : ''}</strong></div>
        <div><span>Keeper notified</span><strong>{fmtDateTime(row.noticeAt)}{row.acknowledgedAt ? ' · acknowledged' : ''}</strong></div>
        <div><span>Scheduled by</span><strong>{row.initiatedBy || '—'}</strong></div>
      </div>
      {row.instructions && <p className="req-note">Instructions to the keeper: “{row.instructions}”</p>}
      {row.cancelReason && <p className="req-note">Cancelled: “{row.cancelReason}”</p>}

      {completed && (
        <>
          <div className="req-body">
            <div><span>Visited on</span><strong>{fmtDate(row.conductedOn)}</strong></div>
            <div><span>Inspector · present at site</span><strong>{row.inspectorName} · {row.presentPerson}</strong></div>
            <div><span>Outcome</span><strong>{row.outcomeLabel}</strong></div>
            <div><span>Stock on site vs chain</span><strong>{kg(row.physicalStockKg)} vs {kg(row.chainStockKg)}{gap !== null && gap !== 0 ? ` (${gap > 0 ? '+' : ''}${gap} kg)` : ''}</strong></div>
          </div>
          <div className="insp-checklist">
            {(meta?.checklist || []).map((item) => {
              const entry = row.checklist?.[item.id]
              if (!entry) return null
              return (
                <div key={item.id}>
                  <span className={`rating-pill rating-${RATING_TONES[entry.rating]}`}>{RATING_LABELS[entry.rating]}</span>
                  <div><strong>{item.label}</strong>{entry.note && <small>{entry.note}</small>}</div>
                </div>
              )
            })}
          </div>
          <p className="req-note">Remarks: “{row.remarks}”</p>
          {row.correctiveActions && <p className="req-note">Corrective actions due {fmtDate(row.correctiveDue)}: “{row.correctiveActions}”</p>}
          {row.internalNote && <p className="req-note">Officer-only note: “{row.internalNote}”</p>}
          <p className="req-note">Reported {fmtDateTime(row.reportedAt)} by {row.reportedBy || 'an officer'}{row.closureNoticeAt ? ` · closure notice issued ${fmtDateTime(row.closureNoticeAt)}` : ''}</p>
        </>
      )}

      <div className="button-row">
        {scheduled && <button className="small-button approve" disabled={!canReport} title={canReport ? '' : `Opens on ${row.scheduledDate}`} onClick={() => onAction('report')}><ClipboardList size={13} />{canReport ? 'File visit report' : `Report opens ${fmtDate(row.scheduledDate)}`}</button>}
        {scheduled && <button className="small-button danger" onClick={() => onAction('cancel')}>Cancel inspection</button>}
        {row.canIssueClosure && <button className="small-button danger" onClick={() => onAction('closure')}><Power size={13} />Issue closure notice</button>}
      </div>
    </div>
  )
}

function useSubmit(onDone) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(path, body) {
    setError('')
    setBusy(true)
    try {
      await api(path, { method: 'POST', body })
      onDone()
    } catch (submitError) {
      setError(submitError.message)
      setBusy(false)
    }
  }

  return { error, busy, submit }
}

function ScheduleModal({ orgs, meta, initialOrg, onClose, onDone }) {
  const [form, setForm] = useState({ orgId: initialOrg || '', purpose: 'ROUTINE', date: isoDay(1), time: '', instructions: '' })
  const { error, busy, submit } = useSubmit(onDone)
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))

  return (
    <Modal title="Schedule an inspection" eyebrow="Notice to the keeper" onClose={onClose}>
      <form onSubmit={(event) => { event.preventDefault(); submit('/admin/inspections', { ...form, orgId: Number(form.orgId) }) }}>
        <p className="note">The keeper sees the notice in the Honey Chain Keeper app straight away and gets a reminder the day before. The date must be at least one day ahead.</p>
        <label className="field">Organisation
          <select value={form.orgId} onChange={set('orgId')} required>
            <option value="">Choose an organisation…</option>
            {orgs.map((org) => <option key={org.id} value={org.id}>{org.name} · {org.region}</option>)}
          </select>
        </label>
        <label className="field">Purpose
          <select value={form.purpose} onChange={set('purpose')}>
            {Object.entries(meta?.purposes || {}).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <div className="two-col">
          <label className="field">Date<input type="date" value={form.date} min={isoDay(1)} max={isoDay(90)} onChange={set('date')} required /></label>
          <label className="field">Time (optional)<input type="time" value={form.time} onChange={set('time')} /></label>
        </div>
        <label className="field">What should the keeper keep ready? (optional)
          <textarea value={form.instructions} onChange={set('instructions')} maxLength={500} placeholder="FSSAI licence, batch and sales records, lab certificates, honey stock and packaging area" />
        </label>
        <ErrorNote>{error}</ErrorNote>
        <div className="button-row"><button className="primary-button" disabled={busy}>Send notice</button><button type="button" className="secondary-button" onClick={onClose}>Cancel</button></div>
      </form>
    </Modal>
  )
}

function ReportModal({ row, meta, user, onClose, onDone }) {
  const today = isoDay()
  const [form, setForm] = useState({
    conductedOn: today < row.scheduledDate ? row.scheduledDate : today,
    inspectorName: user.name,
    presentPerson: '',
    physicalStockKg: '',
    outcome: 'NO_ACTION',
    correctiveActions: '',
    correctiveDue: isoDay(14),
    remarks: '',
    internalNote: '',
  })
  const [checklist, setChecklist] = useState(() => Object.fromEntries(meta.checklist.map((item) => [item.id, { rating: 'OK', note: '' }])))
  const [grade, setGrade] = useState(null)
  const { error, busy, submit } = useSubmit(onDone)

  const suggested = suggestGrade(checklist)
  const chosen = grade || suggested
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const setItem = (id, patch) => setChecklist((current) => ({ ...current, [id]: { ...current[id], ...patch } }))
  const needsActions = CORRECTIVE_OUTCOMES.includes(form.outcome)

  return (
    <Modal title={`Visit report for ${row.orgName}`} eyebrow={`${row.code} · notified for ${fmtDate(row.scheduledDate)}`} onClose={onClose} wide>
      <form onSubmit={(event) => { event.preventDefault(); submit(`/admin/inspections/${row.id}/report`, { ...form, physicalStockKg: form.physicalStockKg === '' ? undefined : Number(form.physicalStockKg), checklist, grade: chosen }) }}>
        <div className="two-col">
          <label className="field">Date of visit<input type="date" value={form.conductedOn} min={row.scheduledDate} max={today} onChange={set('conductedOn')} required /></label>
          <label className="field">Inspector name<input value={form.inspectorName} onChange={set('inspectorName')} required /></label>
        </div>
        <label className="field">Who represented the organisation on site?<input value={form.presentPerson} onChange={set('presentPerson')} placeholder="Name and role, e.g. Ravi Kumar, owner" required /></label>

        <p className="section-title" style={{ marginTop: 18 }}>Checklist</p>
        <div className="insp-form-list">
          {meta.checklist.map((item) => (
            <div key={item.id} className="insp-form-row">
              <strong>{item.label}</strong>
              <select value={checklist[item.id].rating} onChange={(event) => setItem(item.id, { rating: event.target.value })}>
                {meta.ratings.map((rating) => <option key={rating} value={rating}>{RATING_LABELS[rating]}</option>)}
              </select>
              <input value={checklist[item.id].note} placeholder={checklist[item.id].rating === 'MAJOR' ? 'Describe the major finding (required)' : 'Note (optional)'} onChange={(event) => setItem(item.id, { note: event.target.value })} maxLength={300} />
            </div>
          ))}
        </div>

        <div className="two-col">
          <label className="field">Honey stock counted on site (kg)
            <input type="number" min="0" step="0.1" value={form.physicalStockKg} onChange={set('physicalStockKg')} required />
            <small className="field-hint">Chain records {kg(row.chainStockNow)} for this organisation.</small>
          </label>
          <label className="field">Grade <small className="field-hint" style={{ display: 'inline' }}>(suggested: {suggested})</small>
            <select value={chosen} onChange={(event) => setGrade(event.target.value)}>
              {Object.entries(meta.grades).map(([id, label]) => <option key={id} value={id}>{id} · {label}</option>)}
            </select>
          </label>
        </div>

        <label className="field">Outcome
          <select value={form.outcome} onChange={set('outcome')}>
            {Object.entries(meta.outcomes).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        {needsActions && (
          <div className="two-col">
            <label className="field">What must the keeper fix?<textarea value={form.correctiveActions} onChange={set('correctiveActions')} maxLength={800} required /></label>
            <label className="field">Deadline<input type="date" value={form.correctiveDue} min={isoDay(1)} onChange={set('correctiveDue')} required /></label>
          </div>
        )}
        <label className="field">Remarks (the keeper will see these)<textarea value={form.remarks} onChange={set('remarks')} minLength={10} maxLength={1500} required /></label>
        <label className="field">Officer-only note (optional)<textarea value={form.internalNote} onChange={set('internalNote')} maxLength={800} /></label>

        <ErrorNote>{error}</ErrorNote>
        <div className="button-row"><button className="primary-button" disabled={busy}>File report</button><button type="button" className="secondary-button" onClick={onClose}>Cancel</button></div>
      </form>
    </Modal>
  )
}

function CancelModal({ row, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const { error, busy, submit } = useSubmit(onDone)

  return (
    <Modal title={`Cancel ${row.code}?`} eyebrow={row.orgName} onClose={onClose}>
      <form onSubmit={(event) => { event.preventDefault(); submit(`/admin/inspections/${row.id}/cancel`, { reason }) }}>
        <p className="note">The keeper is told the visit will not take place and sees your reason.</p>
        <label className="field">Reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} required minLength={5} maxLength={300} /></label>
        <ErrorNote>{error}</ErrorNote>
        <div className="button-row"><button className="primary-button danger-fill" disabled={busy}>Cancel inspection</button><button type="button" className="secondary-button" onClick={onClose}>Keep it</button></div>
      </form>
    </Modal>
  )
}

function ClosureNoticeModal({ row, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const { error, busy, submit } = useSubmit(onDone)

  return (
    <Modal title={`Closure notice for ${row.orgName}`} eyebrow={`Based on ${row.code} · grade ${row.grade}`} onClose={onClose}>
      <form onSubmit={(event) => { event.preventDefault(); submit(`/admin/inspections/${row.id}/closure`, { reason }) }}>
        <p className="note">The keeper's workspace closes immediately and they see this notice. You then complete the government formalities (FSSAI surrender, GST cancellation and others) in the Review queue under Closures. The inspection is linked to the closure record.</p>
        <label className="field">Grounds for closure<textarea value={reason} onChange={(event) => setReason(event.target.value)} required minLength={5} maxLength={250} placeholder="e.g. Repeated hygiene failures; corrective actions not completed" /></label>
        <ErrorNote>{error}</ErrorNote>
        <div className="button-row"><button className="primary-button danger-fill" disabled={busy}>Issue closure notice</button><button type="button" className="secondary-button" onClick={onClose}>Cancel</button></div>
      </form>
    </Modal>
  )
}
