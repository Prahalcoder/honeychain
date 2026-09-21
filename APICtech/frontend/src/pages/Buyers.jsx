import { useState } from 'react'
import { Users, Plus, Search, Trash2, X, IndianRupee, Clock3 } from 'lucide-react'

import MainLayout from '../layouts/MainLayout'
import { apiRequest } from '../lib/api'
import { money, useApi } from '../lib/store'

const TYPES = ['Wholesaler', 'Retailer', 'Company', 'Direct Consumer']
const fieldClass = 'mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-[#F97360]'

// Buyers live in the company's private database; a new keeper starts with none.
export default function Buyers() {
  const buyerData = useApi('/company/buyers')
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [error, setError] = useState('')

  const buyers = buyerData.data || []
  const filtered = buyers.filter((buyer) => `${buyer.name} ${buyer.type} ${buyer.contact || ''}`.toLowerCase().includes(search.toLowerCase()))
  const purchases = buyers.reduce((total, buyer) => total + buyer.purchases_inr, 0)
  const pending = buyers.reduce((total, buyer) => total + buyer.pending_inr, 0)

  async function remove(buyer) {
    setError('')
    try {
      await apiRequest(`/company/buyers/${buyer.id}`, { method: 'DELETE' })
      await buyerData.reload()
    } catch (removeError) {
      setError(removeError.message)
    }
  }

  return (
    <MainLayout title="Buyers">

      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-black">Buyers</h1>
          <p className="mt-1 text-sm text-gray-500">Distributors, retailers and customers you sell to.</p>
        </div>

        <button onClick={() => setShowAdd(true)} className="flex items-center justify-center gap-2 rounded-xl bg-[#F97360] px-5 py-3 text-sm font-bold">
          <Plus size={18} />
          Add Buyer
        </button>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Stat title="Total Buyers" value={buyers.length} icon={Users} />
        <Stat title="Paid Purchases" value={money.format(purchases)} icon={IndianRupee} />
        <Stat title="Pending Payments" value={money.format(pending)} icon={Clock3} />
      </div>

      <div className="mt-6 rounded-2xl border border-[#c0dfdd] bg-white p-4">
        <div className="relative max-w-lg">
          <Search size={18} className="absolute left-3 top-3 text-gray-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search buyers..."
            className="w-full rounded-xl border border-gray-200 py-3 pl-10 pr-4 text-sm outline-none focus:border-[#F97360]"
          />
        </div>
      </div>

      {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      <div className="mt-6 overflow-hidden rounded-2xl border border-[#c0dfdd] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead className="bg-[#f4fbfb] text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-6 py-4">Buyer</th>
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4">Contact</th>
                <th className="px-6 py-4">Paid</th>
                <th className="px-6 py-4">Pending</th>
                <th className="px-6 py-4">Invoices</th>
                <th className="px-6 py-4" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((buyer) => (
                <tr key={buyer.id} className="border-t border-gray-100">
                  <td className="px-6 py-4">
                    <p className="font-bold">{buyer.name}</p>
                    {buyer.gstin && <p className="mt-0.5 text-xs text-gray-400">GSTIN {buyer.gstin}</p>}
                  </td>
                  <td className="px-6 py-4 text-sm">{buyer.type}</td>
                  <td className="px-6 py-4 text-sm">{buyer.contact || '—'}</td>
                  <td className="px-6 py-4 font-semibold">{money.format(buyer.purchases_inr)}</td>
                  <td className="px-6 py-4 font-semibold text-orange-700">{money.format(buyer.pending_inr)}</td>
                  <td className="px-6 py-4 text-sm">{buyer.invoice_count}</td>
                  <td className="px-6 py-4">
                    <button onClick={() => remove(buyer)} title="Remove buyer" className="text-gray-400 hover:text-red-500"><Trash2 size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <p className="p-10 text-center text-sm text-gray-500">
            {buyers.length === 0 ? 'No buyers yet. Add the distributors and retailers you sell to.' : 'No buyers match your search.'}
          </p>
        )}
      </div>

      {showAdd && <AddBuyer onClose={() => setShowAdd(false)} onDone={async () => { setShowAdd(false); await buyerData.reload() }} />}

    </MainLayout>
  )
}

function AddBuyer({ onClose, onDone }) {
  const [form, setForm] = useState({ name: '', type: 'Wholesaler', contact: '', gstin: '', address: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: field === 'gstin' ? event.target.value.toUpperCase() : event.target.value }))

  async function submit(event) {
    event.preventDefault()
    setError('')
    setSaving(true)

    try {
      await apiRequest('/company/buyers', { method: 'POST', body: JSON.stringify(form) })
      await onDone()
    } catch (addError) {
      setError(addError.message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex justify-between">
          <div>
            <p className="text-xs text-gray-400">NEW BUYER</p>
            <h2 className="text-xl font-black">Add buyer</h2>
          </div>
          <button type="button" onClick={onClose}><X /></button>
        </div>

        <label className="mt-5 block text-sm font-semibold">Name
          <input value={form.name} onChange={set('name')} className={fieldClass} required />
        </label>
        <label className="mt-4 block text-sm font-semibold">Type
          <select value={form.type} onChange={set('type')} className={fieldClass}>{TYPES.map((type) => <option key={type}>{type}</option>)}</select>
        </label>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold">Contact
            <input value={form.contact} onChange={set('contact')} className={fieldClass} />
          </label>
          <label className="block text-sm font-semibold">GSTIN <span className="font-normal text-gray-400">(optional)</span>
            <input value={form.gstin} onChange={set('gstin')} maxLength={15} className={fieldClass} />
          </label>
        </div>
        <label className="mt-4 block text-sm font-semibold">Address <span className="font-normal text-gray-400">(optional)</span>
          <input value={form.address} onChange={set('address')} className={fieldClass} />
        </label>

        {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>}

        <button disabled={saving} className="mt-6 w-full rounded-xl bg-[#F97360] py-3 font-bold disabled:opacity-60">
          {saving ? 'Saving...' : 'Save buyer'}
        </button>
      </form>
    </div>
  )
}

function Stat({ title, value, icon: Icon }) {
  return (
    <div className="rounded-2xl border border-[#c0dfdd] bg-white p-5">
      <div className="w-fit rounded-xl bg-[#dbedeb] p-3"><Icon size={20} /></div>
      <p className="mt-4 text-sm text-gray-500">{title}</p>
      <p className="text-2xl font-black">{value}</p>
    </div>
  )
}
