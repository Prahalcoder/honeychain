import { useState } from 'react'
import { CalendarClock, CheckCircle2, ClipboardCheck } from 'lucide-react'

import MainLayout from '../layouts/MainLayout'
import { apiRequest } from '../lib/api'
import { refreshSummary, useApi } from '../lib/store'

const RATING = {
  OK: ['Satisfactory', 'bg-teal-50 text-teal-700'],
  MINOR: ['Minor issue', 'bg-orange-50 text-orange-700'],
  MAJOR: ['Major issue', 'bg-red-50 text-red-700'],
  NA: ['Not applicable', 'bg-gray-100 text-gray-500'],
}
const GRADE_TONE = { A: 'bg-teal-100 text-teal-800', B: 'bg-teal-100 text-teal-800', C: 'bg-orange-100 text-orange-800', D: 'bg-red-100 text-red-800' }

const day = (value) => new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

// Inspection notices from the KVIC officer, and the reports after each visit.
export default function Inspections() {
  const { data, loading, reload } = useApi('/company/inspections')
  const [busy, setBusy] = useState(false)
  const rows = data || []
  const upcoming = rows.filter((row) => row.status === 'SCHEDULED')
  const past = rows.filter((row) => row.status !== 'SCHEDULED')

  async function acknowledge(id) {
    setBusy(true)
    try {
      await apiRequest(`/company/inspections/${id}/acknowledge`, { method: 'POST' })
      await reload()
      refreshSummary()
    } finally {
      setBusy(false)
    }
  }

  return (
    <MainLayout title="Inspections">
      <div className="mb-6">
        <h1 className="text-2xl font-black">Inspections</h1>
        <p className="mt-1 text-sm text-gray-500">
          KVIC officers give you at least one day of notice before visiting. After the visit you can read the grade and remarks here.
        </p>
      </div>

      {loading && <p className="text-sm text-gray-500">Loading…</p>}

      {upcoming.map((row) => (
        <div key={row.id} className="mb-5 rounded-2xl border border-orange-200 bg-orange-50 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-white p-3"><CalendarClock size={22} className="text-orange-700" /></div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-800">Inspection notice · {row.code}</p>
                <h2 className="mt-1 text-xl font-black">{day(row.scheduledDate)}{row.scheduledTime ? ` at ${row.scheduledTime}` : ''}</h2>
                <p className="mt-1 text-sm text-gray-700">{row.purposeLabel}</p>
              </div>
            </div>
            {row.acknowledgedAt ? (
              <span className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm font-bold text-teal-700"><CheckCircle2 size={16} /> Acknowledged</span>
            ) : (
              <button disabled={busy} onClick={() => acknowledge(row.id)} className="rounded-xl bg-[#0F766E] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#115e59] disabled:opacity-60">
                Acknowledge notice
              </button>
            )}
          </div>
          <p className="mt-4 text-sm text-gray-700">
            <b>Please keep ready:</b> {row.instructions || 'your FSSAI licence and registration papers, harvest and sales records, lab certificates, honey stock and packaging area.'}
          </p>
        </div>
      ))}

      {!loading && rows.length === 0 && (
        <div className="rounded-2xl border border-[#c0dfdd] bg-white p-8 text-center text-sm text-gray-500">
          <ClipboardCheck className="mx-auto mb-3 text-gray-300" size={34} />
          No inspections yet. Notices and reports will appear here.
        </div>
      )}

      {past.length > 0 && <h2 className="mb-3 mt-8 text-lg font-black">Past inspections</h2>}
      <div className="space-y-4">
        {past.map((row) => (
          <div key={row.id} className="rounded-2xl border border-[#c0dfdd] bg-white p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-gray-400">{row.code} · {row.purposeLabel}</p>
                <h3 className="mt-1 text-lg font-black">
                  {row.status === 'COMPLETED' ? `Visited ${day(row.conductedOn)}` : `Cancelled (was ${day(row.scheduledDate)})`}
                </h3>
                {row.status === 'COMPLETED' && <p className="mt-1 text-sm text-gray-500">Inspector: {row.inspectorName}</p>}
              </div>
              {row.status === 'COMPLETED' && (
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-sm font-bold">{row.gradeLabel}</p>
                    <p className="text-xs text-gray-500">{row.outcomeLabel}</p>
                  </div>
                  <span className={`grid h-12 w-12 place-items-center rounded-xl text-2xl font-black ${GRADE_TONE[row.grade]}`}>{row.grade}</span>
                </div>
              )}
            </div>

            {row.status === 'CANCELLED' && <p className="mt-3 text-sm text-gray-600">Reason: {row.cancelReason}</p>}

            {row.status === 'COMPLETED' && (
              <>
                <p className="mt-4 rounded-xl bg-[#f4fbfb] p-4 text-sm text-gray-700"><b>Officer's remarks:</b> {row.remarks}</p>
                {row.correctiveActions && (
                  <p className="mt-3 rounded-xl bg-orange-50 p-4 text-sm text-orange-900">
                    <b>To fix by {day(row.correctiveDue)}:</b> {row.correctiveActions}
                  </p>
                )}
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {row.findings.map((finding) => (
                    <div key={finding.id} className="flex items-start gap-2 rounded-lg border border-gray-100 p-2.5 text-sm">
                      <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${RATING[finding.rating]?.[1]}`}>{RATING[finding.rating]?.[0]}</span>
                      <span>{finding.label}{finding.note && <span className="block text-xs text-gray-500">{finding.note}</span>}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-gray-400">Honey stock counted: {row.physicalStockKg} kg · recorded on the chain: {row.chainStockKg} kg</p>
              </>
            )}
          </div>
        ))}
      </div>
    </MainLayout>
  )
}
