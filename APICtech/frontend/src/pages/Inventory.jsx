import { useState } from 'react'
import { Package, Search, Boxes, Truck, QrCode, X, Eye, Lock } from 'lucide-react'

import MainLayout from '../layouts/MainLayout'
import { formatDate, useApi } from '../lib/store'

const LAB_LABELS = {
  VERIFIED: 'Lab verified',
  PENDING_REVIEW: 'With officer',
  REQUESTED: 'Awaiting certificate',
  REJECTED: 'Certificate rejected',
  FAILED: 'Lab failed',
  NOT_REQUESTED: 'No lab test',
}

// Inventory is calculated from your batches: nothing is typed in or pre-filled.
export default function Inventory() {
  const { data, loading } = useApi('/company/inventory')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)

  const items = data?.items || []
  const totals = data?.totals

  const filtered = items.filter((item) => `${item.batchCode} ${item.honeyType} ${item.hiveCode}`.toLowerCase().includes(search.toLowerCase()))

  return (
    <MainLayout title="Inventory">

      <div>
        <h1 className="text-2xl font-black">Inventory</h1>
        <p className="mt-1 text-sm text-gray-500">
          Honey stock worked out from your harvests, bottles and supply-chain transfers.
        </p>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat title="Total Harvested" value={`${totals?.harvestedKg ?? 0} kg`} icon={Package} />
        <Stat title="In Your Hands" value={`${totals?.holdingKg ?? 0} kg`} icon={Boxes} />
        <Stat title="Sent Down the Chain" value={`${totals?.transferredKg ?? 0} kg`} icon={Truck} />
        <Stat title="Bottle QR Codes" value={totals?.packedBottles ?? 0} icon={QrCode} />
      </div>

      <div className="mt-6 rounded-2xl border border-[#c0dfdd] bg-white p-4">
        <div className="relative max-w-lg">
          <Search size={18} className="absolute left-3 top-3 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search batch..."
            className="w-full rounded-xl border border-gray-200 py-3 pl-10 pr-4 text-sm outline-none focus:border-[#F97360]"
          />
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-[#c0dfdd] bg-white">

        <div className="border-b border-gray-100 p-6">
          <h2 className="font-bold">Batch Inventory</h2>
          <p className="mt-1 text-xs text-gray-500">Add stock by recording a harvest. Every quantity here is backed by the blockchain.</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead className="bg-[#f4fbfb] text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-6 py-4">Batch</th>
                <th className="px-6 py-4">Hive</th>
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4">Harvested</th>
                <th className="px-6 py-4">In hand</th>
                <th className="px-6 py-4">In bottles</th>
                <th className="px-6 py-4">Lab</th>
                <th className="px-6 py-4">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.batchCode} className="border-t border-gray-100 hover:bg-[#f9fdfd]">
                  <td className="px-6 py-4 font-bold">{item.batchCode}</td>
                  <td className="px-6 py-4">{item.hiveCode}</td>
                  <td className="px-6 py-4 text-sm">{item.honeyType}</td>
                  <td className="px-6 py-4 font-semibold">{item.harvestedKg} kg</td>
                  <td className="px-6 py-4 font-semibold">{item.holdingKg} kg</td>
                  <td className="px-6 py-4 text-sm">{item.packedBottles} bottles · {item.packedKg} kg</td>
                  <td className="px-6 py-4">
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${item.lab.unlocked ? 'bg-teal-50 text-teal-600' : 'bg-orange-50 text-orange-600'}`}>
                      {LAB_LABELS[item.lab.labStatus]}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <button onClick={() => setSelected(item)} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold">
                      <Eye size={14} />
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!loading && filtered.length === 0 && (
            <p className="p-10 text-center text-sm text-gray-500">
              {items.length === 0 ? 'No stock yet. Record a harvest to create your first batch.' : 'No batches match your search.'}
            </p>
          )}
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">

            <div className="flex justify-between border-b border-gray-100 p-6">
              <div>
                <p className="text-xs uppercase text-gray-400">Batch</p>
                <h2 className="text-xl font-black">{selected.batchCode}</h2>
              </div>
              <button onClick={() => setSelected(null)}><X /></button>
            </div>

            <div className="space-y-3 p-6">
              <Info label="Hive" value={selected.hiveCode} />
              <Info label="Honey type" value={selected.honeyType} />
              <Info label="Harvested on" value={formatDate(selected.harvestDate)} />

              <div className="rounded-xl bg-[#f4fbfb] p-4">
                <p className="text-xs font-bold text-gray-400">QUANTITY LEDGER</p>
                <div className="mt-3 space-y-2 text-sm">
                  <p>Harvested → {selected.harvestedKg} kg</p>
                  <p>In bottles (QR codes) → {selected.packedKg} kg · {selected.packedBottles} bottles</p>
                  <p>Not yet bottled → {selected.unpackedKg} kg</p>
                  <p>Sent to distributors / retailers → {selected.transferredKg} kg</p>
                  <p className="font-bold">Still with you → {selected.holdingKg} kg</p>
                </div>
              </div>

              {!selected.lab.unlocked && (
                <div className="flex items-start gap-2 rounded-xl border border-orange-200 bg-orange-50 p-3 text-xs text-orange-900">
                  <Lock size={14} className="mt-0.5 shrink-0" />
                  <span>{selected.lab.reason}</span>
                </div>
              )}

              <button onClick={() => setSelected(null)} className="w-full rounded-xl border border-gray-200 py-3 font-bold">Close</button>
            </div>

          </div>
        </div>
      )}

    </MainLayout>
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

function Info({ label, value }) {
  return (
    <div className="flex justify-between rounded-xl bg-[#f4fbfb] px-4 py-3">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-sm font-bold">{value}</span>
    </div>
  )
}
