import { useState } from 'react'
import { Check, FileText, FlaskConical, PenLine, Power, Sparkles, Store, X } from 'lucide-react'

import { API_URL, api, session, useLive } from '../api'
import {
  Empty, ErrorNote, LiveBadge, Modal, ORG_TYPE_LABELS, PageIntro, StatusPill, fmtDate, fmtDateTime, initials, kg,
} from '../ui'

// The regional officer's inbox: organisations asking to join the KVIC
// monitoring chain and lab results shared by beekeepers.
export default function Requests({ params, notify, refreshOverview }) {
  const [tab, setTab] = useState(params.tab || 'organizations')
  const [showDecided, setShowDecided] = useState(false)
  const [decision, setDecision] = useState(null)

  const organizations = useLive('/admin/organizations?status=ALL', { interval: 4000 })
  const labs = useLive('/admin/lab-reviews?status=ALL', { interval: 4000 })
  const closures = useLive('/admin/closures?status=ALL', { interval: 4000 })

  const orgs = organizations.data || []
  const labRows = labs.data || []
  const pendingOrgs = orgs.filter((org) => org.status === 'PENDING_APPROVAL')
  const decidedOrgs = orgs.filter((org) => org.status !== 'PENDING_APPROVAL')
  const pendingLabs = labRows.filter((row) => row.status === 'PENDING')
  const decidedLabs = labRows.filter((row) => row.status !== 'PENDING')
  const closureRows = closures.data || []
  const openClosures = closureRows.filter((row) => row.status === 'REQUESTED')
  const doneClosures = closureRows.filter((row) => row.status !== 'REQUESTED')
  const shownClosures = showDecided ? doneClosures : openClosures

  const shownOrgs = showDecided ? decidedOrgs : pendingOrgs
  const shownLabs = showDecided ? decidedLabs : pendingLabs

  async function submitDecision(note, password) {
    const path = decision.kind === 'org'
      ? `/admin/organizations/${decision.item.id}/decision`
      : `/admin/lab-reviews/${decision.item.id}/decision`

    const result = await api(path, { method: 'POST', body: { decision: decision.value, note, password } })
    notify(result.signed
      ? `${decision.item.batchCode}: certificate verified and digitally signed`
      : `${decision.kind === 'org' ? decision.item.name : decision.item.batchCode}: ${decision.value.toLowerCase()}`)
    setDecision(null)
    organizations.refresh()
    labs.refresh()
    refreshOverview()
  }

  return (
    <>
      <PageIntro
        eyebrow="Governance"
        title="Review queue"
        copy="Decide which organisations join the KVIC monitoring chain and verify the lab results beekeepers share."
        right={<LiveBadge updatedAt={organizations.updatedAt} error={organizations.error} />}
      />

      <div className="tabs">
        <button className={`tab ${tab === 'organizations' ? 'active' : ''}`} onClick={() => setTab('organizations')}><Store size={15} />Registrations {pendingOrgs.length > 0 && <b>{pendingOrgs.length}</b>}</button>
        <button className={`tab ${tab === 'labs' ? 'active' : ''}`} onClick={() => setTab('labs')}><FlaskConical size={15} />Lab results {pendingLabs.length > 0 && <b>{pendingLabs.length}</b>}</button>
        <button className={`tab ${tab === 'closures' ? 'active' : ''}`} onClick={() => setTab('closures')}><Power size={15} />Closures {openClosures.length > 0 && <b>{openClosures.length}</b>}</button>
        <div style={{ marginLeft: 'auto' }} className="chips">
          <button className={`chip ${!showDecided ? 'active' : ''}`} onClick={() => setShowDecided(false)}>Open</button>
          <button className={`chip ${showDecided ? 'active' : ''}`} onClick={() => setShowDecided(true)}>Decided</button>
        </div>
      </div>

      <section className="panel request-panel">
        <div className="request-header">
          <div>
            <h2>{tab === 'organizations' ? 'Organisation registrations' : tab === 'labs' ? 'Lab results' : 'Company closures'}</h2>
            <p>{tab === 'organizations' ? shownOrgs.length : tab === 'labs' ? shownLabs.length : shownClosures.length} {showDecided ? 'decided' : 'awaiting a decision'}</p>
          </div>
        </div>

        {tab === 'organizations' && (shownOrgs.length === 0
          ? <Empty>{showDecided ? 'No decisions recorded yet.' : 'No registrations are waiting. New beekeeper sign-ups appear here instantly.'}</Empty>
          : shownOrgs.map((org) => <OrganizationRequest key={org.id} org={org} onDecide={(value) => setDecision({ kind: 'org', value, item: org })} />))}

        {tab === 'labs' && (shownLabs.length === 0
          ? <Empty>{showDecided ? 'No lab decisions recorded yet.' : 'No lab results are waiting. Results shared from the beekeeper app appear here.'}</Empty>
          : shownLabs.map((row) => <LabRequest key={row.id} row={row} onDecide={(value) => setDecision({ kind: 'lab', value, item: row })} />))}
        {tab === 'closures' && (shownClosures.length === 0
          ? <Empty>{showDecided ? 'No closures completed yet.' : 'No closure requests. Keepers can request closure from Settings; officers can start one from an organisation.'}</Empty>
          : shownClosures.map((row) => <ClosureCard key={row.id} row={row} onDone={(message) => { notify(message); closures.refresh(); organizations.refresh(); refreshOverview() }} />))}
      </section>

      {decision && <DecisionModal decision={decision} onClose={() => setDecision(null)} onSubmit={submitDecision} />}
    </>
  )
}

function OrganizationRequest({ org, onDecide }) {
  const pending = org.status === 'PENDING_APPROVAL'

  return (
    <div className="req-card">
      <div className="req-top">
        <div className="org-avatar gold">{initials(org.name)}</div>
        <div><strong>{org.name}</strong><span>{ORG_TYPE_LABELS[org.type] || org.type} · {org.region}, {org.state} · registered {fmtDateTime(org.createdAt)}</span></div>
        <StatusPill status={org.status} />
      </div>
      <div className="req-body">
        <div><span>Registration no. ({org.registrationBody || 'KVIC'})</span><strong>{org.registrationId}</strong></div>
        <div><span>FSSAI licence</span><strong>{org.fssai}</strong></div>
        <div><span>GSTIN</span><strong>{org.gstin || 'Not provided'}</strong></div>
        <div><span>Contact</span><strong>{org.ownerName}{org.phone ? ` · ${org.phone}` : ''}</strong></div>
      </div>
      {!pending && org.reviewedAt && <p className="req-note">Decided {fmtDateTime(org.reviewedAt)}{org.reviewedBy ? ` by ${org.reviewedBy}` : ''}{org.reviewNote ? `: “${org.reviewNote}”` : ''}</p>}
      {pending && (
        <div className="req-actions">
          <button className="small-button approve" onClick={() => onDecide('APPROVED')}><Check size={14} />Accept into KVIC chain</button>
          <button className="small-button danger" onClick={() => onDecide('REJECTED')}><X size={14} />Reject</button>
        </div>
      )}
    </div>
  )
}

const fileSize = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

function LabRequest({ row, onDecide }) {
  const pending = row.status === 'PENDING'
  const results = row.results || {}
  const [fileError, setFileError] = useState('')

  async function openDocument() {
    setFileError('')
    try {
      const response = await fetch(`${API_URL}/admin/lab-reviews/${row.id}/document`, { headers: { Authorization: `Bearer ${session.token}` } })
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || 'The PDF could not be opened')
      const url = URL.createObjectURL(await response.blob())
      window.open(url, '_blank', 'noopener')
      window.setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (error) { setFileError(error.message) }
  }

  return (
    <div className="req-card">
      <div className="req-top">
        <div className="org-avatar blue"><FlaskConical size={16} /></div>
        <div><strong>{row.batchCode} · {row.orgName}</strong><span>{row.labName} · certificate {row.certificateReference} · shared {fmtDateTime(row.submittedAt)}</span></div>
        <StatusPill status={row.status} />
      </div>
      <div className="req-body">
        <div><span>Batch</span><strong>{kg(row.quantityKg)} {row.honeyType} · harvested {fmtDate(row.harvestDate)}</strong></div>
        <div><span>Certificate says</span><strong>{row.declaredStatus} · tested {fmtDate(row.testedAt)}</strong></div>
        <div><span>Moisture · HMF · Sucrose</span><strong>{[results.moisturePercent != null ? `${results.moisturePercent}%` : '—', results.hmfMgPerKg != null ? `${results.hmfMgPerKg} mg/kg` : '—', results.sucrosePercent != null ? `${results.sucrosePercent}%` : '—'].join(' · ')}</strong></div>
        <div><span>Antibiotic residue</span><strong>{results.antibiotics || '—'}</strong></div>
      </div>
      {results.notes && <p className="req-note">Beekeeper note: {results.notes}</p>}
      <div className="doc-row">
        <FileText size={17} />
        {row.documentName
          ? <><button type="button" className="text-button" onClick={openDocument}>Open scanned certificate</button><span>{row.documentName} · {fileSize(row.documentSize)} · uploaded {fmtDateTime(row.documentUploadedAt)}</span><small title={row.documentSha256}>SHA-256 {row.documentSha256?.slice(0, 12)}…</small></>
          : <span>No scanned copy attached (optional for now).</span>}
      </div>
      {fileError && <p className="req-note" style={{ color: '#b91c1c' }}>{fileError}</p>}
      {row.ai && <AiAnalysis ai={row.ai} />}
      {!pending && row.reviewedAt && <p className="req-note">Decided {fmtDateTime(row.reviewedAt)}{row.reviewedBy ? ` by ${row.reviewedBy}` : ''}{row.reviewNote ? `: “${row.reviewNote}”` : ''}</p>}
      {row.signatureFingerprint && <div className="sig-box"><PenLine size={14} />Digitally signed {fmtDateTime(row.signedAt)} · key <span className="mono">{row.signatureFingerprint}</span></div>}
      {pending && (
        <div className="req-actions">
          <button className="small-button approve" onClick={() => onDecide('VERIFIED')}><PenLine size={14} />Verify and sign</button>
          <button className="small-button danger" onClick={() => onDecide('REJECTED')}><X size={14} />Reject</button>
        </div>
      )}
    </div>
  )
}

// AI analyses; the officer decides. Nothing here approves the certificate.
function AiAnalysis({ ai }) {
  return (
    <div className="ai-panel">
      <div className="ai-head">
        <strong><Sparkles size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />AI-assisted review</strong>
        <span><span className={`risk-pill ${ai.riskLevel}`}>{ai.riskLevel} RISK</span> <small>{ai.engine}</small></span>
      </div>
      <p className="ai-summary">{ai.summary}</p>
      <div className="ai-findings">
        {ai.findings.map((finding) => (
          <div className={`ai-finding ${finding.status}`} key={finding.parameter}>
            <span>{finding.parameter}</span>
            <strong>{finding.value ?? 'Not reported'} <small style={{ display: 'inline' }}>· limit {finding.limit}</small></strong>
            <small>{finding.note}</small>
          </div>
        ))}
      </div>
      {ai.attention.length > 0 && (
        <ul className="ai-attention">{ai.attention.map((line) => <li key={line}>{line}</li>)}</ul>
      )}
      <p className="ai-note">{ai.standard}. {ai.disclaimer}</p>
    </div>
  )
}

export function DecisionModal({ decision, onClose, onSubmit }) {
  const [note, setNote] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const negative = ['REJECTED', 'SUSPENDED'].includes(decision.value)
  const signing = decision.value === 'VERIFIED'
  const subject = decision.kind === 'org' ? decision.item.name : `${decision.item.batchCode} (${decision.item.orgName})`
  const verb = { APPROVED: 'Accept', REJECTED: 'Reject', SUSPENDED: 'Suspend', VERIFIED: 'Verify and sign' }[decision.value]

  async function submit(event) {
    event.preventDefault()
    setError('')
    setBusy(true)

    try {
      await onSubmit(note, password)
    } catch (submitError) {
      setError(submitError.message)
      setBusy(false)
    }
  }

  return (
    <Modal title={`${verb} ${subject}?`} eyebrow="Your decision is recorded on the blockchain and in the audit log" onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field">{negative ? 'Reason (shown to the beekeeper)' : 'Note (optional)'}
          <textarea value={note} onChange={(event) => setNote(event.target.value)} required={negative} minLength={negative ? 5 : undefined} placeholder={negative ? 'Explain what needs to be corrected' : 'Anything the beekeeper should know'} />
        </label>
        {signing && (
          <>
            <p className="sign-note">Verifying applies your digital signature to this certificate. The signature and your approval become part of the traceability record shown to KVIC officers and, in summary, to consumers.</p>
            <label className="field">Confirm your password to sign
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
            </label>
          </>
        )}
        <ErrorNote>{error}</ErrorNote>
        <div className="button-row">
          <button className={`primary-button ${negative ? 'danger-fill' : ''}`} disabled={busy}>{busy ? 'Saving…' : `${verb}`}</button>
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  )
}

// Formal deregistration: the officer confirms each government formality and
// records the reference numbers before the closure can be completed.
function ClosureCard({ row, onDone }) {
  const open = row.status === 'REQUESTED'
  const [items, setItems] = useState({})
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const setItem = (id, patch) => setItems((current) => ({ ...current, [id]: { ...current[id], ...patch } }))
  const shown = open ? items : row.checklist

  async function submit(path, body, message) {
    setError('')
    setBusy(true)
    try {
      await api(path, { method: 'POST', body })
      onDone(message)
    } catch (submitError) {
      setError(submitError.message)
      setBusy(false)
    }
  }

  return (
    <div className="req-card">
      <div className="req-top">
        <div className="org-avatar rose"><Power size={16} /></div>
        <div><strong>{row.orgName}</strong><span>{row.orgCode} · {row.region}, {row.state} · requested {fmtDateTime(row.createdAt)} by {row.initiatedBy === 'BEEKEEPER' ? 'the keeper' : 'a KVIC officer'}</span></div>
        <StatusPill status={open ? 'PENDING' : 'APPROVED'} />
      </div>
      <p className="req-note">Reason: “{row.reason}”{row.inspectionCode ? ` · based on inspection ${row.inspectionCode} (grade ${row.inspectionGrade})` : ''}</p>
      {open && row.readiness && (
        <div className="req-body">
          <div><span>Open lab requests / reviews</span><strong>{row.readiness.openLabWork === 0 ? 'None' : `${row.readiness.openLabWork} (finish first)`}</strong></div>
          <div><span>Honey still recorded with keeper</span><strong>{row.readiness.stockHeldKg} kg</strong></div>
          <div><span>Keeper declarations</span><strong>{row.initiatedBy === 'BEEKEEPER' ? 'Dues settled, stock cleared, records kept' : 'Officer-initiated'}</strong></div>
        </div>
      )}

      <p className="section-title" style={{ marginBottom: 6 }}>Government formalities</p>
      <div className="closure-list">
        {row.items.map((item) => {
          const entry = shown?.[item.id] || {}
          return (
            <div className="closure-item" key={item.id}>
              <label>
                <input type="checkbox" disabled={!open} checked={Boolean(entry.confirmed)} onChange={(event) => setItem(item.id, { confirmed: event.target.checked })} />
                <span><strong>{item.label}</strong><small>{item.detail}</small></span>
              </label>
              {item.reference !== 'none' && (open
                ? <input className="closure-ref" placeholder={`${item.referenceLabel || 'Reference no.'}${item.reference === 'required' ? ' (required)' : ' (optional)'}`} value={entry.reference || ''} onChange={(event) => setItem(item.id, { reference: event.target.value })} />
                : entry.reference && <span className="mono">Ref: {entry.reference}</span>)}
            </div>
          )
        })}
      </div>

      {open ? (
        <>
          <label className="field">Closing note (recorded in the audit log)<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. All formalities verified against the acknowledgements shown by the keeper" /></label>
          <ErrorNote>{error}</ErrorNote>
          <div className="req-actions">
            <button className="small-button danger" disabled={busy} onClick={() => submit(`/admin/closures/${row.id}/complete`, { items, note }, `${row.orgName} has been closed`)}><Power size={14} />Complete closure</button>
            <button className="small-button" disabled={busy} onClick={() => submit(`/admin/closures/${row.id}/decline`, { note }, 'Closure declined; the organisation stays active')}>Decline (needs a note)</button>
          </div>
        </>
      ) : (
        <p className="req-note">Closed {fmtDateTime(row.completedAt)}{row.completedBy ? ` by ${row.completedBy}` : ''}{row.completionNote ? `: “${row.completionNote}”` : ''}</p>
      )}
    </div>
  )
}