import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  BadgeCheck,
  Building2,
  FlaskConical,
  Link2,
  PenLine,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  Store,
  Truck,
  User,
  Package,
} from 'lucide-react'

import { API_URL } from '../lib/api'

// Public consumer page behind every bottle QR code. No account, no private data.
const VERDICTS = {
  VALID: {
    icon: ShieldCheck,
    title: 'Verified authentic honey',
    tone: 'border-teal-300 bg-teal-50 text-teal-900',
    badge: 'bg-teal-600',
  },
  NOT_CERTIFIED: {
    icon: ShieldAlert,
    title: 'Not certified',
    tone: 'border-orange-300 bg-orange-50 text-orange-900',
    badge: 'bg-orange-500',
  },
  UNDER_REVIEW: {
    icon: ShieldAlert,
    title: 'Under review, do not rely on this jar',
    tone: 'border-red-300 bg-red-50 text-red-900',
    badge: 'bg-red-600',
  },
}

const STAGE_ICONS = { KEEPER: User, WHOLESALER: Building2, RETAILER: Store, CONSUMER: ScanLine }

const dateOf = (value) => {
  if (!value) return ''
  const text = String(value)
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00` : /^\d{4}-\d{2}-\d{2} \d/.test(text) ? `${text.replace(' ', 'T')}Z` : text)
  return Number.isNaN(date.getTime()) ? text : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function PublicVerify() {
  const [params, setParams] = useSearchParams()
  const packId = params.get('pack_id') || ''
  const [manual, setManual] = useState('')
  const [state, setState] = useState({ record: null, error: '', loading: Boolean(packId) })

  useEffect(() => {
    if (!packId) return undefined

    let cancelled = false
    setState({ record: null, error: '', loading: true })

    fetch(`${API_URL}/verify?pack_id=${encodeURIComponent(packId)}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(response.status === 404 ? 'This QR code is not registered with Honey Chain. The jar may be counterfeit.' : payload.message || 'Verification failed')
        return payload
      })
      .then((record) => { if (!cancelled) setState({ record, error: '', loading: false }) })
      .catch((error) => { if (!cancelled) setState({ record: null, error: error.message, loading: false }) })

    return () => { cancelled = true }
  }, [packId])

  const { record, error, loading } = state
  const verdict = record && VERDICTS[record.authenticity]

  return (
    <div className="min-h-screen bg-[#eff7f6] pb-16 text-[#122c31]">

      <header className="bg-[#13242a] px-5 py-5 text-white">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <img src="/apictech-logo.png" alt="Honey Chain" className="h-11 w-11 rounded-xl object-cover" />
          <div>
            <p className="text-lg font-black leading-tight">Honey Chain</p>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#b8d2b9]">Consumer verification</p>
          </div>
        </div>
      </header>

      <main className="mx-auto mt-6 max-w-2xl space-y-5 px-4">

        {!packId && (
          <form
            onSubmit={(event) => { event.preventDefault(); if (manual.trim()) setParams({ pack_id: manual.trim() }) }}
            className="rounded-2xl border border-[#c0dfdd] bg-white p-6"
          >
            <ScanLine size={28} className="text-[#0F766E]" />
            <h1 className="mt-3 text-xl font-black">Check your honey</h1>
            <p className="mt-1 text-sm text-gray-500">Scan the QR code on the jar, or type the jar ID printed below it.</p>
            <input value={manual} onChange={(event) => setManual(event.target.value)} placeholder="PB-2026-XXXXXXXX-JAR-000001" className="mt-4 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#F97360]" />
            <button className="mt-3 w-full rounded-xl bg-[#F97360] py-3 text-sm font-bold">Verify</button>
          </form>
        )}

        {loading && <p className="rounded-2xl bg-white p-6 text-center text-sm text-gray-500">Checking the Honey Chain blockchain…</p>}

        {error && (
          <div className="rounded-2xl border border-red-300 bg-red-50 p-6 text-red-900">
            <ShieldAlert size={28} />
            <h1 className="mt-3 text-xl font-black">Could not verify this jar</h1>
            <p className="mt-1 text-sm">{error}</p>
            <button onClick={() => setParams({})} className="mt-4 rounded-xl border border-red-300 px-4 py-2 text-sm font-bold">Try another jar</button>
          </div>
        )}

        {record && (
          <>
            <section className={`rounded-2xl border-2 p-6 ${verdict.tone}`}>
              <div className="flex items-start gap-4">
                <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-white ${verdict.badge}`}><verdict.icon size={30} /></span>
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] opacity-70">{record.authenticity.replace('_', ' ')}</p>
                  <h1 className="text-2xl font-black leading-tight">{verdict.title}</h1>
                  <p className="mt-2 text-sm">{record.reason}</p>
                </div>
              </div>
            </section>

            <Card icon={Package} title="Product">
              <Row label="Product" value={`${record.product.name} · ${record.product.jarSizeGrams} g`} />
              <Row label="Honey type" value={record.product.honeyType} />
              <Row label="Batch" value={record.product.batchCode} />
              <Row label="Harvested" value={dateOf(record.product.harvestDate)} />
              <Row label="Jar ID" value={record.product.packId} mono />
            </Card>

            {record.producer && (
              <Card icon={User} title="Producer and origin">
                <Row label="Producer" value={record.producer.name} />
                <Row label="Origin" value={`${record.producer.region}, ${record.producer.state}`} />
                <Row label="FSSAI licence" value={record.producer.fssaiLicense} />
              </Card>
            )}

            <Card icon={FlaskConical} title="Laboratory verification">
              {record.laboratory ? (
                <>
                  <Row label="Laboratory" value={record.laboratory.labName} />
                  <Row label="Certificate" value={`${record.laboratory.certificateReference} · ${record.laboratory.outcome}`} />
                  <Row label="Tested" value={dateOf(record.laboratory.testedAt)} />
                  <Row label="Moisture" value={record.laboratory.results.moisturePercent != null ? `${record.laboratory.results.moisturePercent} %` : '—'} />
                  <Row label="HMF" value={record.laboratory.results.hmfMgPerKg != null ? `${record.laboratory.results.hmfMgPerKg} mg/kg` : '—'} />
                  <Row label="Antibiotic residue" value={record.laboratory.results.antibiotics === 'NOT_DETECTED' ? 'Not detected' : record.laboratory.results.antibiotics || '—'} />
                </>
              ) : <p className="text-sm text-gray-500">No KVIC-verified laboratory certificate is on record for this jar.</p>}
            </Card>

            <Card icon={PenLine} title="KVIC officer approval and digital certificate">
              {record.approval ? (
                <>
                  <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold ${record.approval.signatureValid ? 'bg-teal-50 text-teal-700' : 'bg-red-50 text-red-700'}`}>
                    <BadgeCheck size={17} />
                    {record.approval.signatureValid ? 'VERIFIED · digital signature valid' : 'Signature could not be verified'}
                  </div>
                  <Row label="Approved by" value={record.approval.officerName} />
                  <Row label="Designation" value={record.approval.designation} />
                  <Row label="Signed" value={dateOf(record.approval.signedAt)} />
                  <Row label="Signature key" value={record.approval.keyFingerprint} mono />
                </>
              ) : <p className="text-sm text-gray-500">Not yet approved by a KVIC officer.</p>}
            </Card>

            <Card icon={Link2} title="Traceability history">
              <ol className="space-y-3">
                {record.timeline.map((event) => (
                  <li key={event.id} className="flex gap-3">
                    <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[#F97360]" />
                    <div>
                      <p className="text-sm font-semibold">{event.label}{event.scope === 'THIS_JAR' ? ' (this jar)' : ''}</p>
                      <p className="text-xs text-gray-400">{dateOf(event.at)} · block #{event.blockHeight}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>

            <Card icon={Truck} title="Supply chain journey">
              <ol className="space-y-4">
                {record.supplyChain.map((step, index) => {
                  const Icon = STAGE_ICONS[step.stage] || Truck
                  return (
                    <li key={`${step.stage}-${index}`} className="flex items-center gap-3">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${step.stage === 'CONSUMER' ? 'bg-gray-100 text-gray-500' : 'bg-[#F97360]'}`}><Icon size={17} /></span>
                      <div>
                        <p className="text-sm font-bold">{step.label}</p>
                        <p className="text-xs text-gray-500">{step.name}{step.quantityKg ? ` · ${step.quantityKg} kg` : ''}{step.at && step.stage !== 'KEEPER' ? ` · ${dateOf(step.at)}` : ''}</p>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </Card>

            <p className="px-2 text-center text-xs text-gray-400">
              Blockchain check: {record.ledger.valid ? `intact · ${record.ledger.blocks} blocks · ${record.ledger.transactions} records` : 'integrity problem detected'}.
              This page shows only public verification information; private business data is never exposed.
            </p>
          </>
        )}

      </main>
    </div>
  )
}

function Card({ icon: Icon, title, children }) {
  return (
    <section className="rounded-2xl border border-[#c0dfdd] bg-white p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-[#168481]"><Icon size={16} />{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function Row({ label, value, mono }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg bg-[#f4fbfb] px-3 py-2">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-right text-sm font-semibold ${mono ? 'break-all font-mono text-xs' : ''}`}>{value || '—'}</span>
    </div>
  )
}
