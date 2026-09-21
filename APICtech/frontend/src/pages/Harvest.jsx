import { useMemo, useState } from 'react'
import {
  Plus,
  Search,
  CalendarDays,
  Droplets,
  Package,
  X,
  CheckCircle2,
  MapPin,
  Eye,
} from 'lucide-react'

import MainLayout from '../layouts/MainLayout'
import { apiRequest } from '../lib/api'
import { formatDate, refreshSummary, useApi, useSummary } from '../lib/store'

const honeyTypes = [
  'Natural Honey',
  'Forest Honey',
  'Wildflower Honey',
  'Floral Honey',
  'Other',
]

const today = () => new Date().toLocaleDateString('en-CA')
// The harvest location starts as the farm name the keeper gave, and can be edited.
const emptyForm = (hive = '', location = '') => ({
  hive,
  date: today(),
  honeyType: 'Natural Honey',
  quantity: '',
  location,
  notes: '',
})

export default function Harvest() {
  const harvestData = useApi('/company/harvests')
  const hiveData = useApi('/company/hives')
  const { summary } = useSummary()
  const [showModal, setShowModal] = useState(false)
  const [selectedHarvest, setSelectedHarvest] = useState(null)
  const [search, setSearch] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [form, setForm] = useState(emptyForm())

  const harvests = harvestData.data || []
  const hives = hiveData.data || []
  const approved = summary?.organization?.status === 'APPROVED'
  const thisMonth = today().slice(0, 7)

  const totalHarvest = useMemo(
    () => harvests.reduce((total, harvest) => total + Number(harvest.quantity_kg), 0),
    [harvests],
  )

  const thisMonthHarvest = useMemo(
    () => harvests
      .filter((harvest) => harvest.harvest_date.startsWith(thisMonth))
      .reduce((total, harvest) => total + Number(harvest.quantity_kg), 0),
    [harvests, thisMonth],
  )

  const filteredHarvests = harvests.filter((harvest) => {
    const query = search.toLowerCase()

    return (
      harvest.batch_code.toLowerCase().includes(query) ||
      harvest.hive_code.toLowerCase().includes(query) ||
      harvest.honey_type.toLowerCase().includes(query)
    )
  })

  const handleFormChange = (field, value) => {
    setForm((previous) => ({
      ...previous,
      [field]: value,
    }))
  }

  const openModal = () => {
    setSubmitError('')
    setForm(emptyForm(hives[0]?.hive_code || '', summary?.farmName || ''))
    setShowModal(true)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setSubmitError('')
    setIsSaving(true)

    try {
      // The server assigns the batch ID and writes the batch to the KVIC chain.
      const created = await apiRequest('/company/harvests', {
        method: 'POST',
        body: JSON.stringify({
          hiveCode: form.hive,
          harvestDate: form.date,
          honeyType: form.honeyType,
          quantityKg: Number(form.quantity),
          location: form.location,
          notes: form.notes,
        }),
      })

      await Promise.all([harvestData.reload(), refreshSummary()])
      setShowModal(false)
      setSelectedHarvest(created)
    } catch (error) {
      setSubmitError(error.message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <MainLayout title="Harvest">

      {/* PAGE HEADER */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">

        <div>
          <h1 className="text-2xl font-black">
            Harvest
          </h1>

          <p className="mt-1 text-sm text-gray-500">
            Record honey harvests and create traceable batches.
          </p>
        </div>

        <button
          onClick={openModal}
          disabled={!approved || hives.length === 0}
          title={!approved ? 'Available once your organisation is approved' : hives.length === 0 ? 'Add a hive first' : undefined}
          className="flex items-center justify-center gap-2 rounded-xl bg-[#F97360] px-5 py-3 text-sm font-bold shadow-sm transition hover:bg-[#0F766E] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={18} />
          Record Harvest
        </button>

      </div>

      {/* SUMMARY CARDS */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">

        <SummaryCard
          title="Total Harvest"
          value={`${Math.round(totalHarvest * 10) / 10} kg`}
          subtitle="All recorded harvests"
          icon={Droplets}
        />

        <SummaryCard
          title="This Month"
          value={`${Math.round(thisMonthHarvest * 10) / 10} kg`}
          subtitle={new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
          icon={CalendarDays}
        />

        <SummaryCard
          title="Batches Created"
          value={harvests.length}
          subtitle="Traceable honey batches"
          icon={Package}
        />

        <SummaryCard
          title="Active Hives"
          value={hives.filter((hive) => hive.status === 'ACTIVE').length}
          subtitle="Available for harvesting"
          icon={Droplets}
        />

      </div>

      {/* SEARCH */}
      <div className="mt-6 rounded-2xl border border-[#c0dfdd] bg-white p-4">

        <div className="relative max-w-lg">

          <Search
            size={18}
            className="absolute left-3 top-3 text-gray-400"
          />

          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search batch ID, hive or honey type..."
            className="w-full rounded-xl border border-gray-200 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-[#F97360]"
          />

        </div>

      </div>

      {/* HARVEST TABLE */}
      <div className="mt-6 overflow-hidden rounded-2xl border border-[#c0dfdd] bg-white">

        <div className="border-b border-gray-100 px-6 py-5">
          <h2 className="font-bold">
            Recent Harvests
          </h2>

          <p className="mt-1 text-xs text-gray-500">
            Every harvest automatically receives a unique Batch ID on the KVIC chain.
          </p>
        </div>

        <div className="overflow-x-auto">

          <table className="w-full min-w-212.5">

            <thead>
              <tr className="border-b border-gray-100 bg-[#f4fbfb] text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-6 py-4">Batch ID</th>
                <th className="px-6 py-4">Hive</th>
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4">Honey Type</th>
                <th className="px-6 py-4">Quantity</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Action</th>
              </tr>
            </thead>

            <tbody>

              {filteredHarvests.map((harvest) => (

                <tr
                  key={harvest.id}
                  className="border-b border-gray-100 last:border-0 hover:bg-[#f9fdfd]"
                >

                  <td className="px-6 py-4">
                    <p className="font-bold">{harvest.batch_code}</p>
                    <p className="mt-1 text-xs text-gray-400">{harvest.location}</p>
                  </td>

                  <td className="px-6 py-4">
                    <span className="rounded-lg bg-[#dbedeb] px-3 py-1.5 text-xs font-bold">
                      {harvest.hive_code}
                    </span>
                  </td>

                  <td className="px-6 py-4 text-sm text-gray-600">
                    {formatDate(harvest.harvest_date)}
                  </td>

                  <td className="px-6 py-4 text-sm">
                    {harvest.honey_type}
                  </td>

                  <td className="px-6 py-4 text-sm font-bold">
                    {harvest.quantity_kg} kg
                  </td>

                  <td className="px-6 py-4">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-3 py-1.5 text-xs font-bold text-teal-600">
                      <CheckCircle2 size={13} />
                      On chain
                    </span>
                  </td>

                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => setSelectedHarvest(harvest)}
                      className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold hover:bg-[#f4fbfb]"
                    >
                      <Eye size={14} />
                      View
                    </button>
                  </td>

                </tr>

              ))}

            </tbody>

          </table>

        </div>

        {filteredHarvests.length === 0 && (
          <div className="px-6 py-12 text-center">
            <Package size={32} className="mx-auto text-gray-300" />
            <p className="mt-3 font-semibold">No harvests found</p>
            <p className="mt-1 text-sm text-gray-400">
              {harvests.length === 0
                ? approved ? 'Record your first harvest to create a batch.' : 'Harvests can be recorded once your organisation is approved.'
                : 'Try a different search.'}
            </p>
          </div>
        )}

      </div>

      {/* INFORMATION PANEL */}
      <div className="mt-6 rounded-2xl border border-[#c0dfdd] bg-white p-6">

        <div className="flex gap-4">

          <div className="rounded-xl bg-[#dbedeb] p-3">
            <Package size={22} />
          </div>

          <div>
            <h2 className="font-bold">
              Why is the Batch ID important?
            </h2>

            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
              Every harvest becomes a traceable batch. The Batch ID
              connects the harvest to laboratory verification, bottle
              QR codes and every custody transfer. The number of bottle
              QR codes you can create is limited by the kilograms in the batch.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold">
              {['Harvest', 'Batch', 'Lab', 'Supply Chain', 'QR'].map((step, index) => (
                <span key={step} className="flex items-center gap-2">
                  {index > 0 && <span className="text-gray-300">→</span>}
                  <span className="rounded-full bg-[#dbedeb] px-3 py-1.5">{step}</span>
                </span>
              ))}
            </div>

          </div>

        </div>

      </div>

      {/* RECORD HARVEST MODAL */}
      {showModal && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/40 p-4">

          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white shadow-2xl">

            <div className="flex items-start justify-between border-b border-gray-100 p-6">

              <div>
                <h2 className="text-xl font-black">Record New Harvest</h2>
                <p className="mt-1 text-sm text-gray-500">Record the honey collected from a hive.</p>
              </div>

              <button
                onClick={() => setShowModal(false)}
                className="rounded-full p-2 hover:bg-gray-100"
              >
                <X size={19} />
              </button>

            </div>

            <form onSubmit={handleSubmit} className="space-y-5 p-6">

              <div>
                <label className="mb-2 block text-sm font-semibold">Hive</label>
                <select
                  value={form.hive}
                  onChange={(event) => handleFormChange('hive', event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#F97360]"
                >
                  {hives.map((hive) => (
                    <option key={hive.hive_code} value={hive.hive_code}>
                      {hive.hive_code} — {hive.location}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">

                <div>
                  <label className="mb-2 block text-sm font-semibold">Harvest Date</label>
                  <input
                    type="date"
                    max={today()}
                    value={form.date}
                    onChange={(event) => handleFormChange('date', event.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#F97360]"
                    required
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold">Quantity (kg)</label>
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={form.quantity}
                    onChange={(event) => handleFormChange('quantity', event.target.value)}
                    placeholder="e.g. 5"
                    className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#F97360]"
                    required
                  />
                </div>

              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold">Honey Type</label>
                <select
                  value={form.honeyType}
                  onChange={(event) => handleFormChange('honeyType', event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#F97360]"
                >
                  {honeyTypes.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold">Harvest Location</label>
                <div className="relative">
                  <MapPin size={17} className="absolute left-3 top-3.5 text-gray-400" />
                  <input
                    type="text"
                    value={form.location}
                    onChange={(event) => handleFormChange('location', event.target.value)}
                    className="w-full rounded-xl border border-gray-200 py-3 pl-10 pr-4 text-sm outline-none focus:border-[#F97360]"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(event) => handleFormChange('notes', event.target.value)}
                  placeholder="Add observations about this harvest..."
                  rows={3}
                  className="w-full resize-none rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#F97360]"
                />
              </div>

              <div className="rounded-xl bg-[#f4fbfb] p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-500">What happens next?</p>
                <p className="mt-2 text-sm leading-6 text-gray-600">
                  A unique Batch ID is created and sealed into the shared KVIC blockchain.
                  Your notes and location stay in your private database. You can then share
                  the lab report with your regional officer and create bottle QR codes.
                </p>
              </div>

              {submitError && (
                <div className="rounded-xl bg-red-50 p-4 text-sm text-red-600">
                  {submitError}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 rounded-xl border border-gray-200 py-3 text-sm font-bold hover:bg-gray-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 rounded-xl bg-[#F97360] py-3 text-sm font-bold hover:bg-[#0F766E] disabled:opacity-60"
                >
                  {isSaving ? 'Recording...' : 'Record Harvest'}
                </button>
              </div>

            </form>

          </div>

        </div>
      )}

      {/* VIEW HARVEST MODAL */}
      {selectedHarvest && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/40 p-4">

          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">

            <div className="flex items-start justify-between border-b border-gray-100 p-6">

              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Harvest Batch</p>
                <h2 className="mt-1 text-xl font-black">{selectedHarvest.batch_code}</h2>
              </div>

              <button onClick={() => setSelectedHarvest(null)} className="rounded-full p-2 hover:bg-gray-100">
                <X size={19} />
              </button>

            </div>

            <div className="space-y-4 p-6">

              <DetailRow label="Hive" value={selectedHarvest.hive_code} />
              <DetailRow label="Harvest Date" value={formatDate(selectedHarvest.harvest_date)} />
              <DetailRow label="Honey Type" value={selectedHarvest.honey_type} />
              <DetailRow label="Quantity" value={`${selectedHarvest.quantity_kg} kg`} />
              <DetailRow label="Location" value={selectedHarvest.location || '—'} />
              <DetailRow
                label="Bottle capacity"
                value={`up to ${Math.floor((Number(selectedHarvest.quantity_kg) * 1000) / 500)} bottles of 500 g`}
              />

              {selectedHarvest.notes && (
                <div className="rounded-xl bg-[#f4fbfb] p-4">
                  <p className="text-xs font-semibold text-gray-400">NOTES</p>
                  <p className="mt-2 text-sm text-gray-600">{selectedHarvest.notes}</p>
                </div>
              )}

              <div className="rounded-xl bg-teal-50 p-4">
                <div className="flex gap-3">
                  <CheckCircle2 size={19} className="mt-0.5 text-teal-600" />
                  <div>
                    <p className="text-sm font-bold text-teal-700">Batch recorded on the KVIC chain</p>
                    <p className="mt-1 text-xs leading-5 text-teal-600">
                      Share the lab report from the Laboratory page, then create bottle QR codes in QR Management.
                    </p>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setSelectedHarvest(null)}
                className="w-full rounded-xl border border-gray-200 py-3 text-sm font-bold hover:bg-gray-50"
              >
                Close
              </button>

            </div>

          </div>

        </div>
      )}

    </MainLayout>
  )
}

function SummaryCard({ title, value, subtitle, icon: Icon }) {
  return (
    <div className="rounded-2xl border border-[#c0dfdd] bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="rounded-xl bg-[#dbedeb] p-3">
          <Icon size={21} />
        </div>
      </div>
      <p className="mt-5 text-sm text-gray-500">{title}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
      <p className="mt-1 text-xs text-gray-400">{subtitle}</p>
    </div>
  )
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-[#f4fbfb] px-4 py-3">
      <span className="text-xs font-semibold text-gray-500">{label}</span>
      <span className="text-sm font-bold">{value}</span>
    </div>
  )
}
