import { useEffect, useState } from 'react'
import {
  Link2,
  CheckCircle2,
  ShieldCheck,
  ShieldAlert,
  FlaskConical,
  Package,
  Database,
  Truck,
} from 'lucide-react'

import MainLayout from '../layouts/MainLayout'
import { apiRequest } from '../lib/api'
import { formatDate, useApi } from '../lib/store'

const EVENT_LABELS = {
  HARVEST_RECORDED: ['Harvest recorded', Package],
  LAB_RESULT_SUBMITTED: ['Lab result shared with officer', FlaskConical],
  LAB_RESULT_VERIFIED: ['Lab result verified by officer', FlaskConical],
  LAB_RESULT_REJECTED: ['Lab result rejected by officer', FlaskConical],
  CUSTODY_TRANSFER: ['Custody transferred', Truck],
}

export default function Traceability() {
  const batchData = useApi('/company/batches')
  const batches = batchData.data || []
  const [batchCode, setBatchCode] = useState('')
  const [details, setDetails] = useState(null)
  const [error, setError] = useState('')

  const selected = batchCode || batches[0]?.batch_code || ''

  useEffect(() => {
    if (!selected) return undefined

    let cancelled = false
    setError('')
    apiRequest(`/traceability/batches/${encodeURIComponent(selected)}`)
      .then((result) => { if (!cancelled) setDetails(result) })
      .catch((loadError) => { if (!cancelled) setError(loadError.message) })

    return () => { cancelled = true }
  }, [selected])

  const batch = details?.batch
  const ledger = details?.ledger

  return (
    <MainLayout title="Traceability">

      <div>
        <h1 className="text-2xl font-black">
          Traceability
        </h1>

        <p className="mt-1 text-sm text-gray-500">
          The blockchain history of each honey batch, exactly as your KVIC officers see it.
        </p>
      </div>

      <div className="mt-6 rounded-2xl border border-[#c0dfdd] bg-white p-5">

        <label className="mb-2 block text-sm font-bold">
          Batch
        </label>

        <select
          value={selected}
          onChange={(event) => { setBatchCode(event.target.value); setDetails(null) }}
          className="w-full max-w-lg rounded-xl border border-gray-200 px-4 py-3 outline-none focus:border-[#F97360]"
        >
          {batches.map((item) => (
            <option key={item.batch_code} value={item.batch_code}>{item.batch_code} · {item.quantity_kg} kg · {item.honey_type}</option>
          ))}
        </select>

        {!batchData.loading && batches.length === 0 && (
          <p className="mt-3 text-sm text-gray-500">Record a harvest to create your first traceable batch.</p>
        )}

      </div>

      {error && <p className="mt-6 rounded-xl bg-red-50 p-4 text-sm text-red-600">{error}</p>}

      {batch && (
        <>
          <div className="mt-6 rounded-2xl border border-[#c0dfdd] bg-white p-6">

            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">

              <div>
                <p className="text-xs uppercase tracking-wider text-gray-400">
                  Batch
                </p>

                <h2 className="text-2xl font-black">
                  {batch.batch_code}
                </h2>
              </div>

              <div className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold ${ledger?.valid ? 'bg-teal-50 text-teal-600' : 'bg-red-50 text-red-600'}`}>
                {ledger?.valid ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
                {ledger?.valid ? `CHAIN VERIFIED · BLOCK #${ledger.headHeight}` : 'CHAIN INTEGRITY PROBLEM'}
              </div>

            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Info title="Hive" value={batch.hive_code} />
              <Info title="Harvest" value={formatDate(batch.harvest_date)} />
              <Info title="Quantity" value={`${batch.quantity_kg} kg`} />
              <Info title="Lab status" value={batch.lab_status.replaceAll('_', ' ')} />
            </div>

          </div>

          <div className="mt-6 rounded-2xl border border-[#c0dfdd] bg-white p-6">

            <div className="flex items-center gap-3">

              <div className="rounded-xl bg-[#dbedeb] p-3">
                <Link2 size={21} />
              </div>

              <div>
                <h2 className="font-bold">
                  Blockchain timeline
                </h2>

                <p className="text-xs text-gray-500">
                  Each event is sealed in a validator-signed block
                </p>
              </div>

            </div>

            <div className="mt-7 space-y-6">

              {details.chain.map((event) => {
                const [label, Icon] = EVENT_LABELS[event.event_type] || [event.event_type, Database]

                return (
                  <Event
                    key={event.id}
                    icon={Icon}
                    title={label}
                    text={`Block #${event.block_height} · ${new Date(event.created_at).toLocaleString('en-IN')} · hash ${event.current_hash.slice(0, 16)}…`}
                  />
                )
              })}

              {details.custody.map((event) => (
                <Event
                  key={`custody-${event.id}`}
                  icon={Truck}
                  title={`Transferred to ${event.to_party_type.toLowerCase()} ${event.to_party_id}`}
                  text={`${event.quantity_kg} kg · ${formatDate(event.created_at)}`}
                />
              ))}

              <Event
                icon={CheckCircle2}
                title="Current holder"
                text={batch.current_holder_id ? `${batch.current_holder_type} ${batch.current_holder_id}` : 'Held by multiple parties'}
              />

            </div>

          </div>
        </>
      )}

    </MainLayout>
  )
}

function Info({ title, value }) {
  return (
    <div className="rounded-xl bg-[#f4fbfb] p-4">
      <p className="text-xs text-gray-400">{title}</p>
      <p className="mt-1 font-bold">{value}</p>
    </div>
  )
}

function Event({ icon: Icon, title, text }) {
  return (
    <div className="flex gap-4">

      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#F97360]">
        <Icon size={18} />
      </div>

      <div>
        <h3 className="font-bold">{title}</h3>

        <p className="mt-1 break-all text-sm leading-6 text-gray-500">
          {text}
        </p>
      </div>

    </div>
  )
}
