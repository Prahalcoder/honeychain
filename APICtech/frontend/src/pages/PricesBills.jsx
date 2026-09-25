import { useState } from 'react'
import { IndianRupee, Receipt, TrendingUp } from 'lucide-react'

import { apiRequest } from '../lib/api'
import { formatDate, money, refreshSummary, useApi } from '../lib/store'

const inputClass = 'w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[#F97360]'
const TONES = { Paid: 'bg-teal-50 text-teal-600', Pending: 'bg-orange-50 text-orange-600', Cancelled: 'bg-gray-100 text-gray-500' }

// The keeper's profile: the standard GST and KVIC minimum prices, the price of each product, the bills and the profit.
export default function PricesAndBills() {
  const summary = useApi('/company/profile-summary')
  const products = useApi('/company/shop/products')
  const gst = summary.data?.gstPercent ?? products.data?.gstPercent ?? 0
  const listings = products.data?.listings || []
  const data = summary.data

  async function savePrice(item, price) {
    await apiRequest(`/company/shop/products/${item.id}`, { method: 'PUT', body: JSON.stringify({ price }) })
    await Promise.all([products.reload(), summary.reload()])
    refreshSummary()
  }

  return (
    <div>
      <h2 className="text-xl font-black">Prices, bills and profit</h2>
      <p className="mt-1 text-sm text-gray-500">The standard GST and the minimum prices are set by KVIC for every keeper. Your prices can be higher than the minimum, never lower.</p>

      <div className="mt-5 rounded-2xl border border-[#f5a524] bg-[#fff7e0] px-5 py-4 text-sm">
        <p className="font-bold text-[#6b4300]">Standard GST on jars: {gst}%</p>
        <p className="mt-1 text-[#6b4300]">Set by KVIC for every registered company. It is added on top of your price on every bill and on Sellers nearby, so the buyer pays your price plus {gst}% GST. The GST is collected for the government, it is not counted as your income.</p>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card icon={IndianRupee} label="Income (before GST)" value={money.format(data?.income || 0)} note={`${money.format(data?.monthIncome || 0)} this month`} />
        <Card icon={Receipt} label="Expenses" value={money.format(data?.expense || 0)} note={`${money.format(data?.monthExpense || 0)} this month`} />
        <Card icon={TrendingUp} label="Profit" value={money.format(data?.profit || 0)} note={`${money.format(data?.monthProfit || 0)} this month`} tone={(data?.profit || 0) < 0 ? 'text-[#a1432f]' : 'text-[#0c6b60]'} />
        <Card icon={Receipt} label="GST collected" value={money.format(data?.gstCollected || 0)} note={`${money.format(data?.billedPending || 0)} still to be paid`} />
      </div>

      <h3 className="mt-8 text-lg font-black">Your product prices</h3>
      {listings.length === 0 ? (
        <p className="mt-2 rounded-xl bg-[#f4fbfb] px-4 py-3 text-sm text-gray-600">You have no products on sale yet. Put jars on sale under Orders, Products for sale.</p>
      ) : (
        <div className="mt-3 grid gap-3">
          {listings.map((item) => <PriceRow key={item.id} item={item} gst={gst} save={(price) => savePrice(item, price)} />)}
        </div>
      )}

      <h3 className="mt-8 text-lg font-black">Bills</h3>
      <p className="text-sm text-gray-500">Your invoices and the orders customers placed on Sellers nearby.</p>
      <div className="mt-3 overflow-x-auto rounded-2xl border border-[#c0dfdd]">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-[#f4fbfb] text-left text-xs uppercase text-gray-500">
            <tr><th className="px-4 py-3">Bill</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">GST</th><th className="px-4 py-3">Total</th><th className="px-4 py-3">Status</th></tr>
          </thead>
          <tbody>
            {(data?.bills || []).map((bill) => (
              <tr key={`${bill.kind}-${bill.ref}`} className="border-t border-gray-100">
                <td className="px-4 py-3"><b className="font-mono">{bill.ref}</b><br /><span className="text-xs text-gray-400">{bill.kind}</span></td>
                <td className="px-4 py-3">{formatDate(bill.date)}</td>
                <td className="px-4 py-3">{bill.party}</td>
                <td className="px-4 py-3">{money.format(bill.gst || 0)}</td>
                <td className="px-4 py-3 font-bold">{money.format(bill.total)}</td>
                <td className="px-4 py-3"><span className={`rounded-full px-3 py-1 text-xs font-bold ${TONES[bill.status]}`}>{bill.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {(data?.bills || []).length === 0 && <p className="p-8 text-center text-sm text-gray-500">No bills yet.</p>}
      </div>
    </div>
  )
}

function Card({ icon: Icon, label, value, note, tone = '' }) {
  return (
    <div className="rounded-2xl border border-[#c0dfdd] bg-[#fbfefe] p-4">
      <div className="w-fit rounded-lg bg-[#dbedeb] p-2"><Icon size={16} /></div>
      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-[#5d7f80]">{label}</p>
      <p className={`text-xl font-black ${tone}`}>{value}</p>
      <p className="text-xs text-gray-400">{note}</p>
    </div>
  )
}

function PriceRow({ item, gst, save }) {
  const [price, setPrice] = useState(String(item.price))
  const [message, setMessage] = useState('')
  const value = Number(price)
  const final = Math.round(value * (1 + gst / 100) * 100) / 100
  const tooLow = !(value >= item.minPrice)

  async function submit() {
    setMessage('')
    try {
      await save(value)
      setMessage('Saved')
    } catch (error) {
      setMessage(error.message)
    }
  }

  return (
    <div className="rounded-2xl border border-[#c0dfdd] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-black">{item.title}</p>
          <p className="text-xs text-gray-500">{item.honeyType} &middot; batch {item.batchCode}</p>
        </div>
        <p className="text-xs font-semibold text-[#6b4300]">KVIC minimum {money.format(item.minPrice)} per jar (before GST)</p>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="text-sm font-semibold">Your price per jar (before GST)
          <input type="number" min={item.minPrice} step="1" value={price} onChange={(event) => { setPrice(event.target.value); setMessage('') }} className={`${inputClass} mt-1 ${tooLow ? 'border-[#a1432f]' : ''}`} />
        </label>
        <div className="text-sm">
          <p className="font-semibold">Buyer pays</p>
          <p className="mt-2 text-lg font-black">{money.format(final || 0)} <span className="text-xs font-normal text-gray-500">incl. {gst}% GST</span></p>
        </div>
        <button disabled={tooLow || value === item.price} onClick={submit} className="rounded-xl bg-[#0F766E] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">Save price</button>
      </div>
      {tooLow && <p className="mt-2 text-xs font-semibold text-[#a1432f]">The price can not be lower than the KVIC minimum of {money.format(item.minPrice)}.</p>}
      {message && !tooLow && <p className="mt-2 text-xs font-semibold text-[#2b5b57]">{message}</p>}
    </div>
  )
}
