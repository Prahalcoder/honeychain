import { useState } from 'react'
import { Ban, Blocks, CalendarClock, ChevronRight, Power, RotateCcw, Search } from 'lucide-react'

import { api, useLive } from '../api'
import {
  Empty, ErrorNote, LiveBadge, Modal, ORG_TYPE_LABELS, PageIntro, StatusPill, fmtDate, fmtDateTime, inr, initials, kg, monthLabel, num,
} from '../ui'
import { DecisionModal } from './Requests'

const FILTERS = [
  ['ALL', 'All'],
  ['APPROVED', 'Approved'],
  ['PENDING_APPROVAL', 'Pending'],
  ['SUSPENDED', 'Suspended'],
  ['REJECTED', 'Rejected'],
  ['CLOSURE_PENDING', 'Closing'],
  ['CLOSED', 'Closed'],
]

const TONES = ['gold', 'green', 'blue', 'rose', 'violet']

export default function Organizations({ user, params, go, notify, refreshOverview }) {
  const [status, setStatus] = useState(params.status || 'ALL')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(params.orgId || null)

  const list = useLive(`/admin/organizations?status=${status}&q=${encodeURIComponent(query)}`, { interval: 5000 })
  const organizations = list.data || []

  return (
    <>
      <PageIntro
        eyebrow="Network directory"
        title="Organizations"
        copy="Every registered beekeeper and startup in your jurisdiction, with what they have produced on the chain."
        right={<LiveBadge updatedAt={list.updatedAt} error={list.error} />}
      />

      <div className="toolbar">
        <div className="searchbox"><Search size={17} /><input placeholder="Search by name, code or registration no." value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <div className="chips">{FILTERS.map(([value, label]) => <button key={value} className={`chip ${status === value ? 'active' : ''}`} onClick={() => setStatus(value)}>{label}</button>)}</div>
      </div>

      <section className="panel org-panel">
        {organizations.length === 0 ? <Empty>No organisations match this filter.</Empty> : (
          <div className="org-grid">
            {organizations.map((org, index) => (
              <button className={`org-card ${org.status === 'PENDING_APPROVAL' ? 'pending' : ''}`} key={org.id} onClick={() => setSelectedId(org.id)}>
                <div className="org-card-top"><div className={`org-avatar ${TONES[index % TONES.length]}`}>{initials(org.name)}</div><StatusPill status={org.status} /></div>
                <h3>{org.name}</h3>
                <p>{org.code} <i /> {ORG_TYPE_LABELS[org.type] || org.type}</p>
                <div className="org-meta"><span><strong>{org.batchCount}</strong> batches</span><span><strong>{num(org.bottles)}</strong> bottles</span><span><strong>{Math.round(org.honeyKg)}</strong> kg</span></div>
                <div className="org-location"><span>{org.region}, {org.state}</span><ChevronRight size={16} /></div>
              </button>
            ))}
          </div>
        )}
      </section>

      {selectedId && (
        <OrganizationDetail
          id={selectedId}
          user={user}
          onClose={() => setSelectedId(null)}
          onChanged={() => { list.refresh(); refreshOverview() }}
          notify={notify}
          onOpenChain={(orgId) => go('chain', { tab: 'batches', orgId })}
          onInspect={(orgId) => go('inspections', { schedule: orgId })}
        />
      )}
    </>
  )
}

function OrganizationDetail({ id, user, onClose, onChanged, notify, onOpenChain, onInspect }) {
  const detail = useLive(`/admin/organizations/${id}`, { interval: 5000 })
  const [decision, setDecision] = useState(null)
  const [closing, setClosing] = useState(false)

  if (!detail.data) return <Modal title="Loading organisation…" onClose={onClose} wide><Empty>{detail.error || 'Loading…'}</Empty></Modal>

  const { organization: org, batches, monthlyIncome, decisions, closure } = detail.data
  const senior = user.role !== 'REGIONAL_OFFICER'

  async function submitDecision(note) {
    await api(`/admin/organizations/${org.id}/decision`, { method: 'POST', body: { decision: decision.value, note } })
    notify(`${org.name}: ${decision.value.toLowerCase()}`)
    setDecision(null)
    detail.refresh()
    onChanged()
  }

  return (
    <Modal title={org.name} eyebrow={`${org.code} · ${ORG_TYPE_LABELS[org.type] || org.type}`} onClose={onClose} wide>
      <div className="button-row" style={{ marginTop: 10 }}>
        <StatusPill status={org.status} />
        {org.status === 'PENDING_APPROVAL' && <>
          <button className="small-button approve" onClick={() => setDecision({ kind: 'org', value: 'APPROVED', item: org })}>Accept into KVIC chain</button>
          <button className="small-button danger" onClick={() => setDecision({ kind: 'org', value: 'REJECTED', item: org })}>Reject</button>
        </>}
        {senior && org.status === 'APPROVED' && <button className="small-button danger" onClick={() => setDecision({ kind: 'org', value: 'SUSPENDED', item: org })}><Ban size={13} />Suspend</button>}
        {senior && ['REJECTED', 'SUSPENDED'].includes(org.status) && <button className="small-button approve" onClick={() => setDecision({ kind: 'org', value: 'APPROVED', item: org })}><RotateCcw size={13} />Reinstate</button>}
        {['APPROVED', 'SUSPENDED'].includes(org.status) && <button className="small-button danger" onClick={() => setClosing(true)}><Power size={13} />Start closure</button>}
        {['APPROVED', 'SUSPENDED'].includes(org.status) && <button className="small-button" onClick={() => onInspect(org.id)}><CalendarClock size={13} />Schedule inspection</button>}
        <button className="small-button" onClick={() => onOpenChain(org.id)}><Blocks size={13} />View blockchain</button>
      </div>

      <div className="kv-grid">
        <div><span>Registration no. ({org.registrationBody || 'KVIC'})</span><strong>{org.registrationId}</strong></div>
        <div><span>FSSAI licence</span><strong>{org.fssai}</strong></div>
        <div><span>GSTIN</span><strong>{org.gstin || 'Not provided'}</strong></div>
        <div><span>Owner</span><strong>{org.ownerName}</strong></div>
        <div><span>Phone · email</span><strong>{[org.phone, org.email].filter(Boolean).join(' · ') || '—'}</strong></div>
        <div><span>Jurisdiction</span><strong>{org.region}, {org.state}</strong></div>
        <div><span>Honey recorded</span><strong>{kg(org.honeyKg)} in {org.batchCount} batches</strong></div>
        <div><span>Bottle QR codes</span><strong>{num(org.bottles)}</strong></div>
        {org.monthIncomeInr !== undefined && <div><span>Income this month</span><strong>{inr(org.monthIncomeInr)}</strong></div>}
      </div>

      <h3 className="section-title">Batches</h3>
      {batches.length === 0 ? <p className="note">No batches recorded yet.</p> : (
        <div className="table-scroll">
          <table className="dtable">
            <thead><tr><th>Batch</th><th>Honey</th><th className="num">Quantity</th><th>Harvested</th><th className="num">Bottles</th><th>Lab</th><th>Status</th></tr></thead>
            <tbody>{batches.map((batch) => (
              <tr key={batch.code}>
                <td><strong>{batch.code}</strong></td><td>{batch.honeyType}</td><td className="num">{kg(batch.quantityKg)}</td>
                <td>{fmtDate(batch.harvestDate)}</td><td className="num">{batch.bottles}</td>
                <td>{batch.labStatus ? <StatusPill status={batch.labStatus} /> : <small>Not shared</small>}</td><td><StatusPill status={batch.status} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {monthlyIncome && <>
        <h3 className="section-title">Monthly income <small style={{ color: '#a0aba8', fontWeight: 400 }}>· totals only, line items stay private</small></h3>
        {monthlyIncome.length === 0 ? <p className="note">No income reported yet.</p> : (
          <div className="kv-grid">{monthlyIncome.map((row) => <div key={row.month}><span>{monthLabel(row.month)}</span><strong>{inr(row.incomeInr)}</strong></div>)}</div>
        )}
      </>}

      <h3 className="section-title">Decision history</h3>
      {decisions.length === 0 ? <p className="note">No decisions recorded yet.</p> : (
        <div className="decision-log">{decisions.map((row) => (
          <div key={row.id}><span><strong>{row.detail?.decision}</strong> by {row.officerName}{row.detail?.note ? ` — “${row.detail.note}”` : ''}</span><small>{fmtDateTime(row.createdAt)}</small></div>
        ))}</div>
      )}

      {closure && ['COMPLETED', 'REQUESTED'].includes(closure.status) && (
        <>
          <h3 className="section-title">Closure record</h3>
          <p className="note">
            {closure.status === 'COMPLETED' ? `Closed ${fmtDateTime(closure.completedAt)}` : 'Closure in progress'} · reason: “{closure.reason}”
            {closure.completionNote ? ` · note: “${closure.completionNote}”` : ''}
          </p>
          <div className="decision-log">
            {closure.items.map((item) => (
              <div key={item.id}>
                <span><strong>{closure.checklist[item.id]?.confirmed ? '✓' : '·'}</strong> {item.label}{closure.checklist[item.id]?.reference ? ` — ref ${closure.checklist[item.id].reference}` : ''}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {closing && <StartClosure org={org} onClose={() => setClosing(false)} onDone={() => { setClosing(false); detail.refresh(); onChanged(); notify('Closure started. Complete the formalities in the Review queue') }} />}
      {decision && <DecisionModal decision={decision} onClose={() => setDecision(null)} onSubmit={submitDecision} />}
    </Modal>
  )
}

function StartClosure({ org, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    try {
      await api(`/admin/organizations/${org.id}/closure`, { method: 'POST', body: { reason } })
      onDone()
    } catch (startError) { setError(startError.message) }
  }

  return (
    <Modal title={`Start closure of ${org.name}?`} eyebrow="Formal deregistration" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="note">The keeper's workspace closes immediately. You then complete the government formalities checklist (FSSAI surrender, GST cancellation and others) in the Review queue.</p>
        <label className="field">Reason for closure<textarea value={reason} onChange={(event) => setReason(event.target.value)} required minLength={5} /></label>
        <ErrorNote>{error}</ErrorNote>
        <div className="button-row"><button className="primary-button danger-fill">Start closure</button><button type="button" className="secondary-button" onClick={onClose}>Cancel</button></div>
      </form>
    </Modal>
  )
}
