import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Package, Search, Boxes, Truck, QrCode, X, Eye, Lock, ShoppingBag } from 'lucide-react'

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
  const { data: shop } = useApi('/company/shop/products')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)

  const items = data?.items || []
  const totals = data?.totals
  const lots = data?.lots || []
  const readyToList = (shop?.available || []).filter((run) => run.jars > 0)

  const filtered = items.filter((item) => `${item.batchCode} ${item.honeyType} ${item.hiveCode}`.toLowerCase().includes(search.toLowerCase()))

  return (
    <MainLayout title="Inventory">

      <div>
        <h1 className="text-2xl font-black">Inventory</h1>
        <p className="mt-1 text-sm text-gray-500">
          Honey stock worked out from your harvests, bottles and supply-chain transfers.
        </p>
      </div>

      {readyToList.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <span><b>{readyToList.reduce((total, run) => total + run.jars, 0)} jars</b> across {readyToList.length} packaging run{readyToList.length === 1 ? '' : 's'} are in stock but not on sale yet — being in Inventory does not put them on Sellers nearby.</span>
          <Link to="/orders" className="whitespace-nowrap rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700">List them for sale →</Link>
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat title="Total Harvested" value={`${totals?.harvestedKg ?? 0} kg`} icon={Package} />
        <Stat title="In Your Hands" value={`${totals?.holdingKg ?? 0} kg`} icon={Boxes} />
        <Stat title="Sent Down the Chain" value={`${totals?.transferredKg ?? 0} kg`} icon={Truck} />
        <Stat title="Bottles Packed" value={totals?.packedBottles ?? 0} icon={QrCode} />
        <Stat title="Bottles In Stock" value={totals?.bottlesInStock ?? 0} icon={ShoppingBag} note={`${totals?.soldBottles ?? 0} sold`} />
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
                <th className="px-6 py-4">Bottles in stock</th>
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
                  <td className="px-6 py-4 text-sm"><b>{item.bottlesInStock}</b> in stock{item.soldBottles > 0 && <span className="text-gray-400"> · {item.soldBottles} sold</span>}</td>
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

      <div className="mt-6 overflow-hidden rounded-2xl border border-[#c0dfdd] bg-white">
        <div className="border-b border-gray-100 p-6">
          <h2 className="font-bold">Bottle stock by packaging run</h2>
          <p className="mt-1 text-xs text-gray-500">Jars sold on a bill (Billing) or ordered through Sellers nearby leave this stock at once. A cancelled bill or order puts them back.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead className="bg-[#f4fbfb] text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-6 py-4">Packaging run</th>
                <th className="px-6 py-4">Batch</th>
                <th className="px-6 py-4">Jar</th>
                <th className="px-6 py-4">Packed</th>
                <th className="px-6 py-4">Sold on bills</th>
                <th className="px-6 py-4">Sold in shop</th>
                <th className="px-6 py-4">In stock</th>
              </tr>
            </thead>
            <tbody>
              {lots.map((lot) => (
                <tr key={lot.packBatchCode} className="border-t border-gray-100">
                  <td className="px-6 py-4 font-bold">{lot.packBatchCode}</td>
                  <td className="px-6 py-4 text-sm">{lot.batchCode} · {lot.honeyType}</td>
                  <td className="px-6 py-4 text-sm">{lot.jarSizeGrams} g</td>
                  <td className="px-6 py-4 text-sm">{lot.packed}</td>
                  <td className="px-6 py-4 text-sm">{lot.soldBills}</td>
                  <td className="px-6 py-4 text-sm">{lot.soldShop}</td>
                  <td className="px-6 py-4"><span className={`rounded-full px-3 py-1 text-xs font-bold ${lot.inStock > 0 ? 'bg-teal-50 text-teal-600' : 'bg-gray-100 text-gray-500'}`}>{lot.inStock} in stock</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && lots.length === 0 && <p className="p-10 text-center text-sm text-gray-500">No jars packed yet. Create QR codes under Packaging after a lab certificate is verified.</p>}
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
                  <p>In bottles (QR codes) → {selected.packedKg} kg · {selected.packedBottles} bottles ({selected.bottlesInStock} in stock, {selected.soldBottles} sold)</p>
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

function Stat({ title, value, icon: Icon, note }) {
  return (
    <div className="rounded-2xl border border-[#c0dfdd] bg-white p-5">
      <div className="w-fit rounded-xl bg-[#dbedeb] p-3">
        <Icon size={20} />
      </div>
      <p className="mt-4 text-sm text-gray-500">{title}</p>
      <p className="text-2xl font-black">{value}</p>
      {note && <p className="text-xs text-gray-400">{note}</p>}
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
