import { useState } from 'react'
import {
  FlaskConical,
  Plus,
  Search,
  CheckCircle2,
  Clock3,
  XCircle,
  FileUp,
  PenLine,
  FileText,
  X,
} from 'lucide-react'

import MainLayout from '../layouts/MainLayout'
import { apiRequest } from '../lib/api'
import { checkPdf, openLabDocument, sizeLabel, uploadLabDocument } from '../lib/labDocument'
import { formatDate, refreshSummary, useApi } from '../lib/store'

const today = () => new Date().toLocaleDateString('en-CA')

// One row per lab request, moving through the stages of the workflow.
function stageOf(item) {
  if (item.request_status === 'REQUESTED') return 'REQUESTED'
  return item.review_status || 'PENDING'
}

const STAGES = {
  REQUESTED: { label: 'Awaiting certificate', tone: 'bg-blue-50 text-blue-600' },
  PENDING: { label: 'With regional officer', tone: 'bg-orange-50 text-orange-600' },
  VERIFIED: { label: 'Verified & signed', tone: 'bg-teal-50 text-teal-600' },
  REJECTED: { label: 'Rejected', tone: 'bg-red-50 text-red-600' },
}

export default function Laboratory() {
  const labData = useApi('/company/lab-requests')
  const batchData = useApi('/company/batches')

  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [showRequest, setShowRequest] = useState(false)
  const [certificateFor, setCertificateFor] = useState(null)

  const rows = labData.data || []
  const batches = batchData.data || []
  const requestable = batches.filter((batch) => !batch.packaging.unlocked
    && !['REQUESTED', 'PENDING_REVIEW'].includes(batch.packaging.labStatus))

  const filtered = rows.filter((item) =>
    `${item.batch_code} ${item.requested_lab} ${item.certificate_reference || ''} ${STAGES[stageOf(item)].label}`
      .toLowerCase()
      .includes(search.toLowerCase())
  )

  const count = (stage) => rows.filter((item) => stageOf(item) === stage).length
  const reload = () => Promise.all([labData.reload(), batchData.reload(), refreshSummary()])

  return (
    <MainLayout title="Laboratory">

      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">

        <div>
          <h1 className="text-2xl font-black">Laboratory</h1>
          <p className="mt-1 text-sm text-gray-500">
            Request a lab test, attach the laboratory certificate, and your regional officer verifies it.
            Packaging and QR codes unlock only after the officer signs the certificate.
          </p>
        </div>

        <button
          onClick={() => setShowRequest(true)}
          disabled={requestable.length === 0}
          title={requestable.length === 0 ? 'Every batch is already tested or in progress' : undefined}
          className="flex items-center justify-center gap-2 rounded-xl bg-[#F97360] px-5 py-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={18} />
          Request Lab Test
        </button>

      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat title="Requests" value={rows.length} icon={FlaskConical} />
        <Stat title="Need Certificate" value={count('REQUESTED')} icon={FileUp} />
        <Stat title="With Officer" value={count('PENDING')} icon={Clock3} />
        <Stat title="Verified" value={count('VERIFIED')} icon={CheckCircle2} />
        <Stat title="Rejected" value={count('REJECTED')} icon={XCircle} />
      </div>

      <div className="mt-6 rounded-2xl border border-[#c0dfdd] bg-white p-4">
        <div className="relative max-w-lg">
          <Search size={18} className="absolute left-3 top-3 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search batch, laboratory or certificate..."
            className="w-full rounded-xl border border-gray-200 py-3 pl-10 pr-4 text-sm outline-none focus:border-[#F97360]"
          />
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-[#c0dfdd] bg-white">

        <div className="border-b border-gray-100 p-6">
          <h2 className="font-bold">Laboratory Requests</h2>
        </div>

        <div className="overflow-x-auto">

          <table className="w-full min-w-[800px]">

            <thead className="bg-[#f4fbfb] text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-6 py-4">Batch</th>
                <th className="px-6 py-4">Laboratory</th>
                <th className="px-6 py-4">Requested</th>
                <th className="px-6 py-4">Certificate</th>
                <th className="px-6 py-4">Stage</th>
                <th className="px-6 py-4">Action</th>
              </tr>
            </thead>

            <tbody>
              {filtered.map((item) => {
                const stage = STAGES[stageOf(item)]

                return (
                  <tr key={item.request_id} className="border-t border-gray-100">
                    <td className="px-6 py-4 font-bold">{item.batch_code}</td>
                    <td className="px-6 py-4 text-sm">{item.lab_name || item.requested_lab}</td>
                    <td className="px-6 py-4 text-sm">{formatDate(item.requested_at)}</td>
                    <td className="px-6 py-4 text-sm">{item.certificate_reference || '—'}</td>
                    <td className="px-6 py-4">
                      <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${stage.tone}`}>{stage.label}</span>
                    </td>
                    <td className="px-6 py-4">
                      {item.request_status === 'REQUESTED' ? (
                        <button onClick={() => setCertificateFor(item)} className="rounded-lg bg-[#F97360] px-3 py-2 text-xs font-bold">
                          Submit certificate
                        </button>
                      ) : (
                        <button onClick={() => setSelected(item)} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold">
                          View
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {filtered.length === 0 && (
            <p className="p-10 text-center text-sm text-gray-500">
              {rows.length === 0 ? 'No lab tests requested yet. Request a test for a harvested batch.' : 'No results match your search.'}
            </p>
          )}

        </div>
      </div>

      {selected && <ResultModal item={selected} onClose={() => setSelected(null)} onChanged={async () => { setSelected(null); await reload() }} />}

      {showRequest && (
        <RequestModal
          batches={requestable}
          onClose={() => setShowRequest(false)}
          onDone={async () => { setShowRequest(false); await reload() }}
        />
      )}

      {certificateFor && (
        <CertificateModal
          request={certificateFor}
          onClose={() => setCertificateFor(null)}
          onDone={async () => { setCertificateFor(null); await reload() }}
        />
      )}

    </MainLayout>
  )
}

const fieldClass = 'mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-[#F97360]'

function ModalShell({ eyebrow, title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-400">{eyebrow}</p>
            <h2 className="text-xl font-black">{title}</h2>
          </div>
          <button type="button" onClick={onClose}><X /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function RequestModal({ batches, onClose, onDone }) {
  const [form, setForm] = useState({ batchCode: batches[0]?.batch_code || '', labName: '', note: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setSaving(true)

    try {
      await apiRequest('/company/lab-requests', { method: 'POST', body: JSON.stringify(form) })
      await onDone()
    } catch (requestError) {
      setError(requestError.message)
      setSaving(false)
    }
  }

  return (
    <ModalShell eyebrow="STEP 1" title="Request a lab test" onClose={onClose}>
      <form onSubmit={submit}>
        <label className="mt-5 block text-sm font-semibold">Batch
          <select value={form.batchCode} onChange={set('batchCode')} className={fieldClass} required>
            {batches.map((batch) => <option key={batch.batch_code} value={batch.batch_code}>{batch.batch_code} · {batch.quantity_kg} kg · {batch.honey_type}</option>)}
          </select>
        </label>
        <label className="mt-4 block text-sm font-semibold">Laboratory
          <input value={form.labName} onChange={set('labName')} placeholder="NABL accredited laboratory" className={fieldClass} required />
        </label>
        <label className="mt-4 block text-sm font-semibold">Note for the laboratory
          <textarea value={form.note} onChange={set('note')} rows={2} className={fieldClass} />
        </label>
        <p className="mt-3 text-xs text-gray-500">Send the sample to the laboratory. When the certificate arrives, attach it here so your regional officer can review it.</p>
        {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>}
        <button disabled={saving} className="mt-6 w-full rounded-xl bg-[#F97360] py-3 font-bold disabled:opacity-60">
          {saving ? 'Requesting...' : 'Request lab test'}
        </button>
      </form>
    </ModalShell>
  )
}

function CertificateModal({ request, onClose, onDone }) {
  const [form, setForm] = useState({
    certificateReference: '',
    status: 'PASSED',
    testedAt: today(),
    moisturePercent: '',
    hmfMgPerKg: '',
    sucrosePercent: '',
    antibiotics: 'NOT_DETECTED',
    notes: '',
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [file, setFile] = useState(null)
  const [sentWithoutPdf, setSentWithoutPdf] = useState(false)
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))

  const chooseFile = (event) => {
    const chosen = event.target.files?.[0] || null
    const problem = checkPdf(chosen)
    setError(problem)
    if (problem) event.target.value = ''
    setFile(problem ? null : chosen)
  }

  const submit = async (event) => {
    event.preventDefault()
    if (sentWithoutPdf) return onDone()
    setError('')
    setSaving(true)

    try {
      const created = await apiRequest(`/company/lab-requests/${request.request_id}/result`, {
        method: 'POST',
        body: JSON.stringify({
          certificateReference: form.certificateReference,
          status: form.status,
          testedAt: form.testedAt,
          results: {
            moisturePercent: form.moisturePercent,
            hmfMgPerKg: form.hmfMgPerKg,
            sucrosePercent: form.sucrosePercent,
            antibiotics: form.antibiotics,
            notes: form.notes,
          },
        }),
      })

      if (file) {
        try {
          await uploadLabDocument(created.reviewId, file)
        } catch (uploadError) {
          setSentWithoutPdf(true)
          setError(`Your certificate was sent, but the PDF could not be uploaded: ${uploadError.message} You can attach it later by opening the request.`)
          setSaving(false)
          return
        }
      }

      await onDone()
    } catch (submitError) {
      setError(submitError.message)
      setSaving(false)
    }
  }

  return (
    <ModalShell eyebrow={`STEP 2 · ${request.batch_code} · ${request.requested_lab}`} title="Submit the laboratory certificate" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold">Certificate number
            <input value={form.certificateReference} onChange={set('certificateReference')} className={fieldClass} required />
          </label>
          <label className="block text-sm font-semibold">Test date
            <input type="date" max={today()} value={form.testedAt} onChange={set('testedAt')} className={fieldClass} required />
          </label>
          <label className="block text-sm font-semibold">Certificate outcome
            <select value={form.status} onChange={set('status')} className={fieldClass}>
              <option value="PASSED">Passed</option>
              <option value="FAILED">Failed</option>
            </select>
          </label>
          <label className="block text-sm font-semibold">Antibiotic residue
            <select value={form.antibiotics} onChange={set('antibiotics')} className={fieldClass}>
              <option value="NOT_DETECTED">Not detected</option>
              <option value="DETECTED">Detected</option>
            </select>
          </label>
        </div>

        <p className="mt-5 text-xs font-bold uppercase tracking-wide text-gray-400">Test values exactly as printed on the certificate</p>
        <div className="mt-2 grid gap-4 sm:grid-cols-3">
          <label className="block text-sm font-semibold">Moisture (%)
            <input type="number" step="0.01" min="0" value={form.moisturePercent} onChange={set('moisturePercent')} className={fieldClass} />
          </label>
          <label className="block text-sm font-semibold">HMF (mg/kg)
            <input type="number" step="0.1" min="0" value={form.hmfMgPerKg} onChange={set('hmfMgPerKg')} className={fieldClass} />
          </label>
          <label className="block text-sm font-semibold">Sucrose (%)
            <input type="number" step="0.01" min="0" value={form.sucrosePercent} onChange={set('sucrosePercent')} className={fieldClass} />
          </label>
        </div>

        <label className="mt-4 block text-sm font-semibold">Note for the officer
          <textarea value={form.notes} onChange={set('notes')} rows={2} className={fieldClass} />
        </label>

        <div className="mt-4 rounded-xl border border-dashed border-[#f76049] bg-[#f4fbfb] p-4">
          <p className="flex items-center gap-2 text-sm font-semibold"><FileText size={16} className="text-[#0F766E]" />Scanned copy of the certificate <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-500">Optional for now</span></p>
          <p className="mt-1 text-xs text-gray-500">PDF only, up to 10 MB. It is shown to your regional officer as proof and will become compulsory later.</p>
          <input type="file" accept="application/pdf,.pdf" onChange={chooseFile} disabled={sentWithoutPdf} className="mt-3 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[#f86751] file:px-4 file:py-2 file:font-bold file:text-[#10262a]" />
          {file && <p className="mt-2 text-xs font-semibold text-teal-700">{file.name} · {sizeLabel(file.size)}</p>}
        </div>

        <p className="mt-3 text-xs text-gray-500">AI will highlight unusual values for your regional officer. The officer alone decides whether the certificate is verified.</p>
        {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>}

        <button disabled={saving} className="mt-6 w-full rounded-xl bg-[#F97360] py-3 font-bold disabled:opacity-60">
          {saving ? (file ? 'Sending certificate and PDF...' : 'Submitting...') : sentWithoutPdf ? 'Close' : 'Send to regional officer'}
        </button>
      </form>
    </ModalShell>
  )
}

function ResultModal({ item, onClose, onChanged }) {
  const results = item.results || {}
  const stage = stageOf(item)
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const canAttach = item.review_id && item.review_status === 'PENDING'

  const open = async () => {
    setProblem('')
    try { await openLabDocument(item.review_id) } catch (openError) { setProblem(openError.message) }
  }

  const attach = async (event) => {
    const chosen = event.target.files?.[0]
    const invalid = checkPdf(chosen)
    if (invalid) { setProblem(invalid); event.target.value = ''; return }
    setBusy(true)
    setProblem('')
    try {
      await uploadLabDocument(item.review_id, chosen)
      await onChanged()
    } catch (uploadError) {
      setProblem(uploadError.message)
      setBusy(false)
    }
  }

  return (
    <ModalShell eyebrow="LAB CERTIFICATE" title={item.batch_code} onClose={onClose}>
      <div className="mt-5 space-y-3">
        <Info label="Laboratory" value={item.lab_name || item.requested_lab} />
        <Info label="Certificate" value={`${item.certificate_reference} (${item.declared_status})`} />
        <Info label="Tested" value={formatDate(item.tested_at)} />
        <Info label="Moisture" value={results.moisturePercent != null ? `${results.moisturePercent} %` : '—'} />
        <Info label="HMF" value={results.hmfMgPerKg != null ? `${results.hmfMgPerKg} mg/kg` : '—'} />
        <Info label="Antibiotic residue" value={results.antibiotics || '—'} />

        <div className="rounded-xl border border-[#c0dedc] p-4">
          <p className="text-xs font-bold text-gray-400">SCANNED CERTIFICATE (PDF)</p>
          {item.document_name ? (
            <button onClick={open} className="mt-2 flex w-full items-center gap-3 rounded-lg bg-[#f4fbfb] p-3 text-left hover:bg-[#d7eae9]">
              <FileText size={20} className="text-[#0F766E]" />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{item.document_name}</span><span className="text-xs text-gray-500">{sizeLabel(item.document_size)} · click to open</span></span>
            </button>
          ) : (
            <p className="mt-2 text-sm text-gray-500">No scanned copy attached. It is optional for now.</p>
          )}
          {canAttach && (
            <label className="mt-3 block text-xs font-semibold text-gray-600">{item.document_name ? 'Replace the PDF (up to 10 MB)' : 'Attach a PDF (up to 10 MB)'}
              <input type="file" accept="application/pdf,.pdf" onChange={attach} disabled={busy} className="mt-1 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[#f86751] file:px-3 file:py-1.5 file:font-bold file:text-[#10262a]" />
            </label>
          )}
          {busy && <p className="mt-2 text-xs text-gray-500">Uploading…</p>}
          {problem && <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-600">{problem}</p>}
        </div>

        <div className="rounded-xl bg-[#f4fbfb] p-5">
          <p className="text-xs font-bold text-gray-400">CERTIFICATION JOURNEY</p>
          <div className="mt-3 space-y-3">
            <Step text="Lab test requested" done />
            <Step text="Laboratory certificate submitted" done />
            <Step text="AI-assisted review by regional officer" done={stage === 'VERIFIED' || stage === 'REJECTED'} />
            <Step text="Verified and digitally signed" done={stage === 'VERIFIED'} failed={stage === 'REJECTED'} />
            <Step text="Packaging and QR generation unlocked" done={stage === 'VERIFIED' && item.declared_status === 'PASSED'} />
          </div>
          {item.reviewed_at && (
            <p className="mt-4 text-xs text-gray-500">
              {stage === 'VERIFIED' ? 'Verified' : 'Rejected'} on {formatDate(item.reviewed_at)}{item.reviewed_by ? ` by ${item.reviewed_by}` : ''}
              {item.review_note ? `: “${item.review_note}”` : ''}
            </p>
          )}
          {item.signature_fingerprint && (
            <p className="mt-3 flex items-center gap-2 rounded-lg bg-teal-50 px-3 py-2 text-xs text-teal-700">
              <PenLine size={13} />Digital signature key <span className="font-mono">{item.signature_fingerprint}</span>
            </p>
          )}
        </div>

        <button onClick={onClose} className="w-full rounded-xl border border-gray-200 py-3 font-bold">
          Close
        </button>
      </div>
    </ModalShell>
  )
}

function Stat({ title, value, icon: Icon }) {
  return (
    <div className="rounded-2xl border border-[#c0dfdd] bg-white p-5">
      <div className="w-fit rounded-xl bg-[#dbedeb] p-3">
        <Icon size={20} />
      </div>

      <p className="mt-4 text-sm text-gray-500">{title}</p>
      <p className="text-2xl font-black">{value}</p>
    </div>
  )
}

function Step({ text, done, failed }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <div
        className={`flex h-6 w-6 items-center justify-center rounded-full ${
          failed ? 'bg-red-100 text-red-600' : done ? 'bg-teal-100 text-teal-600' : 'bg-gray-100 text-gray-400'
        }`}
      >
        {failed ? <XCircle size={15} /> : done ? <CheckCircle2 size={15} /> : <Clock3 size={15} />}
      </div>

      <span className={done || failed ? 'font-semibold' : 'text-gray-400'}>
        {text}
      </span>
    </div>
  )
}

function Info({ label, value }) {
  return (
    <div className="flex justify-between rounded-xl bg-[#f4fbfb] px-4 py-3">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-sm font-bold">{value}</span>
    </div>
  )
}
