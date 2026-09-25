import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Boxes,
  CheckCircle2,
  FlaskConical,
  IndianRupee,
  Package,
  Plus,
  Receipt,
  Scale,
  Store,
  Truck,
  Undo2,
  User,
  X,
} from 'lucide-react'

import MainLayout from '../layouts/MainLayout'
import { apiRequest } from '../lib/api'
import { formatDate, money, useApi } from '../lib/store'
import WholesaleOffers from '../components/WholesaleOffers'

const inputClass = 'mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[#F97360]'
const today = () => new Date().toLocaleDateString('en-CA')
const round2 = (value) => Math.round(value * 100) / 100
const amountLabel = (grams) => (grams >= 1000 ? `${round2(grams / 1000)} kg` : `${grams} g`)

const PAYMENT = {
  Paid: { label: 'Paid', tone: 'bg-teal-100 text-teal-800' },
  Pending: { label: 'Payment pending', tone: 'bg-orange-100 text-orange-800' },
  Cancelled: { label: 'Cancelled', tone: 'bg-gray-100 text-gray-600' },
}

// After harvest the keeper sells loose honey to a named wholesaler, in kg or grams, at a fixed
// price per kg. The wholesaler tests it and sells it on, so no KVIC lab certificate is needed.
export default function SupplyChain() {
  const stockData = useApi('/company/sales/stock')
  const salesData = useApi('/company/sales')
  const buyerData = useApi('/company/buyers')

  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState(searchParams.get('tab') === 'offers' ? 'offers' : 'sales')
  const offerData = useApi('/company/trade-requests')
  const receiptData = useApi('/company/trade-requests/receipts')
  const openOffers = (offerData.data || []).filter((offer) => offer.status === 'PENDING').length
    + (receiptData.data || []).filter((receipt) => receipt.status === 'AWAITING_HARVEST').length
  const [creating, setCreating] = useState(null)
  const [action, setAction] = useState(null)
  const [banner, setBanner] = useState('')

  const stock = stockData.data || []
  const sales = salesData.data || []
  const buyers = buyerData.data || []
  const live = sales.filter((sale) => sale.status === 'ACTIVE')

  const totals = useMemo(() => ({
    harvestedKg: round2(stock.reduce((sum, batch) => sum + batch.harvestedKg, 0)),
    soldKg: round2(live.reduce((sum, sale) => sum + sale.quantityKg, 0)),
    amount: live.reduce((sum, sale) => sum + sale.totalInr, 0),
    pending: live.filter((sale) => sale.paymentStatus === 'Pending').reduce((sum, sale) => sum + sale.totalInr, 0),
  }), [stock, live])

  const reload = () => Promise.all([stockData.reload(), salesData.reload(), buyerData.reload(), offerData.reload(), receiptData.reload()])

  async function markPaid(sale) {
    try {
      await apiRequest(`/company/invoices/${sale.invoiceId}`, { method: 'PATCH', body: JSON.stringify({ status: 'Paid' }) })
      setBanner(`${money.format(sale.totalInr)} from ${sale.buyerName} recorded as income in Finance.`)
      await reload()
    } catch (error) { setBanner(error.message) }
  }

  return (
    <MainLayout title="Supply Chain">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-black">Supply Chain</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            After harvest, sell your honey loose to a wholesaler in kg or grams at an agreed price per kg. The wholesaler tests it themselves and sells it on. Every sale is billed, booked as income and sealed on the blockchain.
          </p>
        </div>
        <button onClick={() => setCreating({})} className="flex items-center justify-center gap-2 rounded-xl bg-[#F97360] px-5 py-3 font-bold">
          <Plus size={18} />New sale
        </button>
      </div>

      <p className="mt-4 flex items-start gap-3 rounded-xl border border-[#c0dedc] bg-[#f4fbfb] p-3 text-sm text-[#1d464e]">
        <FlaskConical size={18} className="mt-0.5 shrink-0" />
        Selling loose honey does not need a KVIC lab certificate. Honey you pack into your own QR jars still must be lab-verified first, and it counts against what is left in the batch.
      </p>

      {banner && <p className="mt-4 rounded-xl bg-teal-50 p-3 text-sm text-teal-800">{banner}</p>}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Boxes} tone="from-[#f86751] to-[#F97360]" label="Honey harvested" value={`${totals.harvestedKg} kg`} note="across your batches" />
        <Stat icon={Scale} tone="from-[#60a5fa] to-[#4f46e5]" label="Sold loose" value={`${totals.soldKg} kg`} note={`${live.length} sale${live.length === 1 ? '' : 's'}`} />
        <Stat icon={IndianRupee} tone="from-[#34d3c8] to-[#05968c]" label="Sales value" value={money.format(totals.amount)} note="incl. GST if charged" />
        <Stat icon={Receipt} tone="from-[#fb7185] to-[#e11d48]" label="Payment pending" value={money.format(totals.pending)} note="to collect from wholesalers" />
      </div>

      <div className="mt-6 flex gap-2 overflow-x-auto">
        {[['sales', 'Sales'], ['offers', 'Wholesale offers'], ['stock', 'Honey available'], ['journey', 'Batch journey']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold ${tab === id ? 'bg-[#0F766E] text-white' : 'border border-[#c0dfdd] bg-white text-gray-600'}`}>
            {label}
            {id === 'offers' && openOffers > 0 && <span className="rounded-full bg-[#F97360] px-2 py-0.5 text-[11px] text-[#14272e]">{openOffers}</span>}
          </button>
        ))}
      </div>

      {tab === 'sales' && (
        <div className="mt-5 space-y-4">
          {sales.length === 0 && (
            <div className="rounded-2xl border border-dashed border-[#f76049] bg-white p-10 text-center">
              <Truck className="mx-auto text-[#f76049]" size={40} />
              <p className="mt-3 font-black">No sales yet</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">Record a harvest, then sell the loose honey to a wholesaler. You choose the quantity and the price per kg, and a bill is created for you.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-3 text-sm font-bold">
                <Link to="/harvest" className="rounded-xl border border-gray-200 px-4 py-2">1 · Record a harvest</Link>
                <button onClick={() => setCreating({})} className="rounded-xl bg-[#F97360] px-4 py-2">2 · New sale</button>
              </div>
            </div>
          )}
          {sales.map((sale) => (
            <SaleCard key={sale.id} sale={sale} onPaid={() => markPaid(sale)} onCancel={() => setAction(sale)} />
          ))}
        </div>
      )}

      {tab === 'stock' && (
        <div className="mt-5 overflow-hidden rounded-2xl border border-[#c0dfdd] bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead className="bg-[#f4fbfb] text-left text-xs uppercase text-gray-500">
                <tr><th className="px-6 py-4">Batch</th><th className="px-6 py-4">Harvested</th><th className="px-6 py-4">Reserved for QR jars</th><th className="px-6 py-4">Sold loose</th><th className="px-6 py-4">Available</th><th className="px-6 py-4" /></tr>
              </thead>
              <tbody>
                {stock.map((batch) => (
                  <tr key={batch.batchCode} className="border-t border-gray-100">
                    <td className="px-6 py-4"><p className="font-bold">{batch.batchCode}</p><p className="text-xs text-gray-400">{batch.honeyType} · {formatDate(batch.harvestDate)}</p></td>
                    <td className="px-6 py-4 text-sm">{batch.harvestedKg} kg</td>
                    <td className="px-6 py-4 text-sm">{batch.packedKg} kg</td>
                    <td className="px-6 py-4 text-sm">{batch.soldLooseKg} kg</td>
                    <td className="px-6 py-4 font-black">{batch.availableKg} kg</td>
                    <td className="px-6 py-4 text-right">
                      {batch.availableGrams > 0
                        ? <button onClick={() => setCreating({ batchCode: batch.batchCode })} className="rounded-lg bg-[#0F766E] px-3 py-2 text-xs font-bold text-white">Sell this honey</button>
                        : <span className="text-xs text-gray-400">Nothing left to sell</span>}
                    </td>
                  </tr>
                ))}
                {stock.length === 0 && <tr><td colSpan={6} className="px-6 py-10 text-center text-sm text-gray-500">Record a harvest to see the honey you can sell.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'journey' && <BatchJourney batches={stock} />}
      {tab === 'offers' && <WholesaleOffers offers={offerData.data} receipts={receiptData.data || []} stock={stock} error={offerData.error} onChanged={reload} onBanner={setBanner} />}

      {creating && (
        <SaleModal
          preset={creating}
          stock={stock}
          buyers={buyers}
          reloadBuyers={buyerData.reload}
          onClose={() => setCreating(null)}
          onDone={async (created, paid) => {
            setCreating(null)
            setBanner(`Sale ${created.code} recorded. Bill ${created.invoiceNumber} for ${money.format(created.totalInr)} ${paid ? 'is paid and booked as income.' : 'is waiting for payment.'}`)
            setTab('sales')
            await reload()
          }}
        />
      )}

      {action && <CancelModal sale={action} onClose={() => setAction(null)} onDone={async () => { setAction(null); setBanner('Sale cancelled. The honey is back in the batch.'); await reload() }} />}
    </MainLayout>
  )
}

function Stat({ icon: Icon, tone, label, value, note }) {
  return (
    <div className="rounded-2xl border border-[#c0dedc] bg-white p-5 shadow-[0_10px_28px_rgba(30,71,80,0.1)]">
      <div className={`inline-flex rounded-2xl bg-gradient-to-br p-3 text-white shadow-lg ${tone}`}><Icon size={22} /></div>
      <p className="mt-4 text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
      <p className="mt-1 text-xs text-gray-400">{note}</p>
    </div>
  )
}

function SaleCard({ sale, onPaid, onCancel }) {
  const payment = sale.status === 'CANCELLED' ? PAYMENT.Cancelled : PAYMENT[sale.paymentStatus] || PAYMENT.Pending
  const Icon = sale.buyerType === 'Retailer' ? Store : sale.buyerType === 'Direct Consumer' ? User : Package

  return (
    <div className={`rounded-2xl border border-[#c0dfdd] bg-white p-5 shadow-sm ${sale.status === 'CANCELLED' ? 'opacity-70' : ''}`}>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div className="flex items-start gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#dbedeb] text-[#178c88]"><Icon size={22} /></div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-gray-400">{sale.code} · {formatDate(sale.saleDate)}</p>
            <h3 className="text-lg font-black leading-tight">{sale.buyerName}</h3>
            <p className="text-sm text-gray-500">{sale.buyerType}{sale.buyerContact ? ` · ${sale.buyerContact}` : ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right"><p className="text-2xl font-black leading-none">{money.format(sale.totalInr)}</p><p className="text-xs text-gray-500">{sale.gstPercent ? `incl. ${sale.gstPercent}% GST` : 'no GST'}</p></div>
          <span className={`rounded-full px-3 py-1.5 text-xs font-black ${payment.tone}`}>{payment.label}</span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold">
        <span className="rounded-lg bg-[#f4fbfb] px-3 py-1.5">{amountLabel(sale.quantityGrams)} of {sale.batchCode}</span>
        <span className="rounded-lg bg-[#f4fbfb] px-3 py-1.5">₹{sale.pricePerKg} per kg</span>
        {sale.invoiceNumber && <span className="rounded-lg bg-[#f4fbfb] px-3 py-1.5">Bill {sale.invoiceNumber}</span>}
        {!sale.publicName && sale.buyerType !== 'Direct Consumer' && <span className="rounded-lg bg-gray-100 px-3 py-1.5 text-gray-600">Name hidden on public page</span>}
      </div>
      {sale.note && <p className="mt-3 text-sm text-gray-600">{sale.note}</p>}
      {sale.cancelReason && <p className="mt-3 text-sm text-red-600">Cancelled: {sale.cancelReason}</p>}

      {sale.status === 'ACTIVE' && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-4">
          {sale.paymentStatus === 'Pending' && (
            <>
              <button onClick={onPaid} className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-bold text-white"><CheckCircle2 size={15} />Mark as paid</button>
              <button onClick={onCancel} className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-bold"><Undo2 size={15} />Cancel sale</button>
            </>
          )}
          <Link to="/billing" className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-bold"><Receipt size={15} />View bill</Link>
        </div>
      )}
    </div>
  )
}

function Modal({ title, eyebrow, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-10 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-2xl rounded-3xl bg-white p-7 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <button onClick={onClose} className="absolute right-5 top-5 text-gray-400" aria-label="Close"><X size={20} /></button>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#199995]">{eyebrow}</p>
        <h2 className="mt-1 text-2xl font-black">{title}</h2>
        {children}
      </div>
    </div>
  )
}

function SaleModal({ preset, stock, buyers, reloadBuyers, onClose, onDone }) {
  const sellable = stock.filter((batch) => batch.availableGrams > 0)
  const [form, setForm] = useState({
    buyerId: '', batchCode: preset.batchCode || sellable[0]?.batchCode || '', quantity: '', unit: 'kg', pricePerKg: '',
    gstPercent: '0', saleDate: today(), paid: false, note: '', publicName: true,
  })
  const [newBuyer, setNewBuyer] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))

  const batch = stock.find((item) => item.batchCode === form.batchCode)
  const buyer = buyers.find((item) => String(item.id) === String(form.buyerId))
  const wholesalers = buyers.filter((item) => ['Wholesaler', 'Company'].includes(item.type))
  const others = buyers.filter((item) => !['Wholesaler', 'Company'].includes(item.type))

  const grams = Math.round((Number(form.quantity) || 0) * (form.unit === 'kg' ? 1000 : 1))
  const subtotal = round2((grams / 1000) * (Number(form.pricePerKg) || 0))
  const gst = round2((subtotal * Number(form.gstPercent)) / 100)
  const tooMuch = batch && grams > batch.availableGrams

  useEffect(() => {
    if (!form.buyerId && wholesalers.length === 1) setForm((current) => ({ ...current, buyerId: String(wholesalers[0].id) }))
  }, [wholesalers.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const addWholesaler = async () => {
    setError('')
    try {
      const created = await apiRequest('/company/buyers', { method: 'POST', body: JSON.stringify({ ...newBuyer, type: 'Wholesaler' }) })
      setForm((current) => ({ ...current, buyerId: String(created.id) }))
      setNewBuyer(null)
      await reloadBuyers()
    } catch (addError) { setError(addError.message) }
  }

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      const created = await apiRequest('/company/sales', {
        method: 'POST',
        body: JSON.stringify({ ...form, buyerId: Number(form.buyerId), quantity: Number(form.quantity), pricePerKg: Number(form.pricePerKg), gstPercent: Number(form.gstPercent) }),
      })
      await onDone(created, form.paid)
    } catch (submitError) {
      setError(submitError.message)
      setSaving(false)
    }
  }

  return (
    <Modal eyebrow="Sell loose honey" title="New sale" onClose={onClose}>
      {sellable.length === 0 ? (
        <p className="mt-5 rounded-xl bg-orange-50 p-4 text-sm text-orange-900">You have no honey left to sell. Record a harvest under <Link to="/harvest" className="font-bold underline">Harvest</Link> first.</p>
      ) : (
        <form onSubmit={submit}>
          <div className="mt-5 flex items-end gap-3">
            <label className="block flex-1 text-sm font-semibold">Wholesaler / buyer
              <select value={form.buyerId} onChange={set('buyerId')} className={inputClass} required>
                <option value="">Choose the buyer…</option>
                {wholesalers.length > 0 && <optgroup label="Wholesalers and companies">{wholesalers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>}
                {others.length > 0 && <optgroup label="Other buyers">{others.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.type}</option>)}</optgroup>}
              </select>
            </label>
            <button type="button" onClick={() => setNewBuyer(newBuyer ? null : { name: '', contact: '', gstin: '' })} className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-bold">{newBuyer ? 'Cancel' : '+ New wholesaler'}</button>
          </div>

          {newBuyer && (
            <div className="mt-3 grid gap-3 rounded-xl border border-[#c0dedc] bg-[#fafdfd] p-4 sm:grid-cols-3">
              <input value={newBuyer.name} onChange={(event) => setNewBuyer({ ...newBuyer, name: event.target.value })} placeholder="Wholesaler name" className={`${inputClass} mt-0`} />
              <input value={newBuyer.contact} onChange={(event) => setNewBuyer({ ...newBuyer, contact: event.target.value })} placeholder="Phone (optional)" className={`${inputClass} mt-0`} />
              <input value={newBuyer.gstin} onChange={(event) => setNewBuyer({ ...newBuyer, gstin: event.target.value })} placeholder="GSTIN (optional)" className={`${inputClass} mt-0`} />
              <button type="button" onClick={addWholesaler} disabled={newBuyer.name.trim().length < 2} className="rounded-xl bg-[#0F766E] py-2 text-sm font-bold text-white disabled:opacity-50 sm:col-span-3">Save wholesaler</button>
            </div>
          )}

          <label className="mt-4 block text-sm font-semibold">Honey from harvest
            <select value={form.batchCode} onChange={set('batchCode')} className={inputClass} required>
              {sellable.map((item) => <option key={item.batchCode} value={item.batchCode}>{item.batchCode} · {item.availableKg} kg available · {item.honeyType}</option>)}
            </select>
          </label>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-semibold">Quantity sold
                <div className="mt-1 flex gap-2">
                  <input type="number" min="0" step="any" value={form.quantity} onChange={set('quantity')} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[#F97360]" required />
                  <div className="flex overflow-hidden rounded-xl border border-gray-200 text-sm font-bold">
                    {['kg', 'g'].map((unit) => <button type="button" key={unit} onClick={() => setForm({ ...form, unit })} className={`px-4 ${form.unit === unit ? 'bg-[#F97360]' : 'bg-white text-gray-500'}`}>{unit}</button>)}
                  </div>
                </div>
              </label>
              {batch && <button type="button" onClick={() => setForm({ ...form, quantity: String(form.unit === 'kg' ? batch.availableKg : batch.availableGrams) })} className="mt-1 text-xs font-bold text-[#178c88]">Sell everything available ({batch.availableKg} kg)</button>}
            </div>
            <label className="block text-sm font-semibold">Agreed price per kg (₹)
              <input type="number" min="1" step="any" value={form.pricePerKg} onChange={set('pricePerKg')} className={inputClass} required />
            </label>
            <label className="block text-sm font-semibold">Sale date
              <input type="date" min={batch?.harvestDate} max={today()} value={form.saleDate} onChange={set('saleDate')} className={inputClass} required />
            </label>
            <label className="block text-sm font-semibold">GST
              <select value={form.gstPercent} onChange={set('gstPercent')} className={inputClass}>
                <option value="0">No GST</option><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option>
              </select>
            </label>
          </div>

          <div className={`mt-4 rounded-xl p-4 text-sm font-semibold ${tooMuch ? 'bg-red-50 text-red-700' : 'bg-[#f4fbfb]'}`}>
            {tooMuch
              ? `Only ${batch.availableKg} kg of ${batch.batchCode} is left to sell.`
              : <>{amountLabel(grams)} × ₹{Number(form.pricePerKg) || 0}/kg = <span className="text-lg font-black">{money.format(subtotal + gst)}</span>{gst > 0 ? ` (incl. ${money.format(gst)} GST)` : ''}</>}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[[false, 'Pay later', 'A pending bill is created. Mark it paid when the money arrives.'], [true, 'Paid now', 'The amount is booked as income in Finance.']].map(([value, label, hint]) => (
              <label key={label} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${form.paid === value ? 'border-[#F97360] bg-[#f4fbfb]' : 'border-gray-200'}`}>
                <input type="radio" checked={form.paid === value} onChange={() => setForm({ ...form, paid: value })} className="mt-1" />
                <span><b>{label}</b><span className="block text-xs text-gray-500">{hint}</span></span>
              </label>
            ))}
          </div>

          <label className="mt-4 block text-sm font-semibold">Note <span className="font-normal text-gray-400">(optional)</span>
            <input value={form.note} onChange={set('note')} maxLength={200} className={inputClass} />
          </label>

          {buyer && buyer.type !== 'Direct Consumer' && (
            <label className="mt-4 flex items-start gap-3 rounded-xl border border-[#c0dedc] p-3 text-sm">
              <input type="checkbox" checked={form.publicName} onChange={(event) => setForm({ ...form, publicName: event.target.checked })} className="mt-1 h-4 w-4" />
              <span><b>Show {buyer.name} on the public verification page</b><span className="block text-xs text-gray-500">Anyone checking this batch on the Honey Chain website sees who bought the honey. Untick to show "name withheld". The price is never shown.</span></span>
            </label>
          )}

          {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>}

          <button disabled={saving || tooMuch} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#0F766E] py-3 font-bold text-white disabled:opacity-60">
            <Truck size={17} />{saving ? 'Recording…' : 'Record sale'}
          </button>
        </form>
      )}
    </Modal>
  )
}

function CancelModal({ sale, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      await apiRequest(`/company/sales/${sale.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) })
      await onDone()
    } catch (submitError) {
      setError(submitError.message)
      setSaving(false)
    }
  }

  return (
    <Modal eyebrow={sale.code} title="Cancel this sale?" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="mt-4 text-sm text-gray-600">{amountLabel(sale.quantityGrams)} goes back into {sale.batchCode}, the bill is cancelled and the hand-over is reversed on the blockchain. Only unpaid sales can be cancelled.</p>
        <label className="mt-4 block text-sm font-semibold">Reason
          <input value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={160} className={inputClass} required />
        </label>
        {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>}
        <button disabled={saving} className="mt-6 w-full rounded-xl bg-[#0F766E] py-3 font-bold text-white disabled:opacity-60">{saving ? 'Saving…' : 'Cancel the sale'}</button>
      </form>
    </Modal>
  )
}

// The full chain of events for one batch, from harvest to the last hand-over.
function BatchJourney({ batches }) {
  const [batchCode, setBatchCode] = useState('')
  const [details, setDetails] = useState(null)
  const [error, setError] = useState('')
  const selected = batchCode || batches[0]?.batchCode || ''

  useEffect(() => {
    if (!selected) return undefined
    let cancelled = false
    apiRequest(`/traceability/batches/${encodeURIComponent(selected)}`)
      .then((result) => { if (!cancelled) { setDetails(result); setError('') } })
      .catch((loadError) => { if (!cancelled) setError(loadError.message) })
    return () => { cancelled = true }
  }, [selected])

  const verified = details?.chain?.find((event) => event.event_type === 'LAB_RESULT_VERIFIED')
  const partyLabel = { WHOLESALER: 'Sold to a wholesaler', RETAILER: 'Sold to a retailer', APICTECH: 'Returned to you' }

  const steps = details ? [
    { title: 'Harvested', subtitle: `Hive ${details.batch.hive_code}`, date: formatDate(details.batch.harvest_date), quantity: `${details.batch.quantity_kg} kg`, icon: Package, complete: true },
    ...details.custody.map((move) => ({
      title: partyLabel[move.to_party_type] || move.to_party_type,
      subtitle: move.to_party_id === 'APICTECH' ? `Returned by ${move.from_party_id}` : move.to_party_id,
      date: formatDate(move.created_at),
      quantity: `${move.quantity_kg} kg`,
      icon: move.to_party_type === 'RETAILER' ? Store : move.to_party_type === 'APICTECH' ? Undo2 : Truck,
      complete: true,
    })),
    { title: 'Laboratory verified (for your own QR jars)', subtitle: verified ? 'Certificate verified and digitally signed by a KVIC officer' : 'Not needed for loose sales. Required before you pack QR jars.', date: verified ? formatDate(verified.created_at) : '', icon: FlaskConical, complete: Boolean(verified) },
    { title: 'Consumer', subtitle: 'Scans a jar QR to verify', date: '', icon: User, complete: false },
  ] : []

  return (
    <div className="mt-5 rounded-2xl border border-[#c0dfdd] bg-white p-6">
      <label className="block text-sm font-bold">Batch
        <select value={selected} onChange={(event) => { setBatchCode(event.target.value); setDetails(null) }} className="mt-2 w-full max-w-lg rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#F97360]">
          {batches.map((batch) => <option key={batch.batchCode} value={batch.batchCode}>{batch.batchCode} · {batch.harvestedKg} kg · {batch.honeyType}</option>)}
        </select>
      </label>
      {batches.length === 0 && <p className="mt-3 text-sm text-gray-500">Record a harvest to see its journey here.</p>}
      {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      <div className="mt-6">
        {steps.map((step, index) => {
          const Icon = step.icon
          return (
            <div key={`${step.title}-${index}`} className="relative flex gap-5 pb-6 last:pb-0">
              {index < steps.length - 1 && <div className="absolute left-[19px] top-10 h-full w-px bg-[#c0dfdd]" />}
              <div className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${step.complete ? 'bg-[#F97360]' : 'bg-gray-100 text-gray-400'}`}><Icon size={18} /></div>
              <div className="flex-1 rounded-xl border border-gray-100 p-4">
                <div className="flex flex-col justify-between gap-1 sm:flex-row">
                  <div><h3 className="font-bold">{step.title}</h3><p className="mt-1 text-sm text-gray-500">{step.subtitle}</p></div>
                  <span className="text-xs text-gray-400">{step.date}</span>
                </div>
                {step.quantity && <div className="mt-2 inline-flex rounded-lg bg-[#f4fbfb] px-3 py-1.5 text-xs font-bold">{step.quantity}</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
