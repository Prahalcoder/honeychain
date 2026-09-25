import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BadgeCheck, MapPin, X } from 'lucide-react'

import TradeLayout, { useTradeSummary } from '../../layouts/TradeLayout'
import { apiRequest } from '../../lib/api'
import { formatDate, money } from '../../lib/store'

// Loose honey that registered beekeepers still have in their books (harvested minus sold, packed and already
// offered for), with KVIC's minimum price for each kind. An offer below that minimum is refused by the server.
export default function Market() {
  const trade = useTradeSummary()
  const summary = trade.summary
  const [filters, setFilters] = useState({ state: '', honeyType: '', verified: false })
  const [listings, setListings] = useState(null)
  const [error, setError] = useState('')
  const [offerFor, setOfferFor] = useState(null)
  const [notice, setNotice] = useState('')

  const approved = summary?.organization.status === 'APPROVED'
  const load = async () => {
    const query = new URLSearchParams()
    if (filters.state) query.set('state', filters.state)
    if (filters.honeyType) query.set('honeyType', filters.honeyType)
    if (filters.verified) query.set('verified', '1')
    try { setListings(await apiRequest(`/trade/market?${query}`)); setError('') } catch (err) { setError(err.message) }
  }

  useEffect(() => { if (approved) load() }, [approved, filters]) // eslint-disable-line react-hooks/exhaustive-deps

  // Nearest first: the wholesaler's own region, then own state, then the rest (each by quantity).
  const sorted = useMemo(() => {
    if (!listings || !summary) return listings
    const rank = (item) => (item.keeper.region === summary.organization.region ? 0 : item.keeper.state === summary.organization.state ? 1 : 2)
    return [...listings].sort((a, b) => rank(a) - rank(b) || b.availableKg - a.availableKg)
  }, [listings, summary])

  const stats = summary?.offers
  return (
    <TradeLayout title="Honey market" trade={trade}>
      {stats && (
        <div className="mb-6 grid gap-3 sm:grid-cols-4">
          {[['Open offers', stats.open], ['Accepted offers', stats.accepted], ['Honey bought', `${stats.boughtKg} kg`], ['Spent', money.format(stats.spentInr)]].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-[#c0dfdd] bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#5d7f80]">{label}</p>
              <p className="mt-1 text-xl font-black">{value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-end gap-3 rounded-2xl border border-[#c0dfdd] bg-white p-4">
        <label className="text-sm font-semibold">State
          <select value={filters.state} onChange={(event) => setFilters({ ...filters, state: event.target.value })} className="mt-1 block rounded-xl border border-[#c6e2e0] bg-[#f7fbfb] px-3 py-2 text-sm">
            <option value="">All states</option>
            {(summary?.filters.states || []).map((state) => <option key={state}>{state}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold">Honey
          <select value={filters.honeyType} onChange={(event) => setFilters({ ...filters, honeyType: event.target.value })} className="mt-1 block rounded-xl border border-[#c6e2e0] bg-[#f7fbfb] px-3 py-2 text-sm">
            <option value="">All kinds</option>
            {(summary?.filters.honeyTypes || []).map((type) => <option key={type}>{type}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm font-semibold">
          <input type="checkbox" checked={filters.verified} onChange={(event) => setFilters({ ...filters, verified: event.target.checked })} /> Lab-verified only
        </label>
        <p className="ml-auto pb-2 text-xs text-gray-400">{sorted ? `${sorted.length} batches` : ''}</p>
      </div>

      {notice && <p className="mb-4 rounded-xl bg-[#e6f3f2] p-3 text-sm font-semibold text-[#0F766E]">{notice} <Link to="/trade/offers" className="underline">See my offers</Link></p>}
      {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>}
      {!sorted && !error && <p className="text-sm text-gray-500">Loading honey on offer…</p>}
      {sorted?.length === 0 && <p className="rounded-2xl border border-dashed border-[#c0dfdd] p-8 text-center text-sm text-gray-500">No loose honey matches these filters right now.</p>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(sorted || []).map((item) => (
          <article key={item.batchCode} className="flex flex-col rounded-2xl border border-[#c0dfdd] bg-white p-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-black">{item.honeyType}</h2>
                <p className="font-mono text-[11px] text-gray-400">{item.batchCode}</p>
              </div>
              {item.labVerified
                ? <span className="flex shrink-0 items-center gap-1 rounded-full bg-[#e6f3f2] px-2.5 py-1 text-[11px] font-bold text-[#0F766E]"><BadgeCheck size={13} /> Lab verified</span>
                : <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-500">Not lab tested</span>}
            </div>
            <p className="mt-3 text-sm font-bold">{item.keeper.name}</p>
            <p className="flex items-center gap-1 text-xs text-gray-500"><MapPin size={12} /> {[item.keeper.place, item.keeper.region, item.keeper.state].filter(Boolean).join(', ')}</p>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-[#f4fbfb] p-2"><p className="text-[10px] font-semibold uppercase text-[#5d7f80]">Available</p><p className="font-black">{item.availableKg} kg</p></div>
              <div className="rounded-xl bg-[#f4fbfb] p-2"><p className="text-[10px] font-semibold uppercase text-[#5d7f80]">KVIC min</p><p className="font-black">₹{item.minPricePerKg}/kg</p></div>
              <div className="rounded-xl bg-[#f4fbfb] p-2"><p className="text-[10px] font-semibold uppercase text-[#5d7f80]">Harvested</p><p className="text-xs font-bold">{formatDate(item.harvestDate)}</p></div>
            </div>
            {item.pendingKg > 0 && <p className="mt-2 text-xs text-gray-400">{item.pendingKg} kg more is under other buyers' offers.</p>}
            <button onClick={() => { setOfferFor(item); setNotice('') }} className="mt-4 rounded-xl bg-[#0F766E] py-2.5 text-sm font-bold text-white hover:bg-[#115e59]">Make an offer</button>
          </article>
        ))}
      </div>

      {offerFor && <OfferDialog item={offerFor} onClose={() => setOfferFor(null)} onSent={(code) => { setOfferFor(null); setNotice(`Offer ${code} sent to the beekeeper.`); load(); trade.reload() }} />}
    </TradeLayout>
  )
}

function OfferDialog({ item, onClose, onSent }) {
  const today = new Date().toLocaleDateString('en-CA')
  const [form, setForm] = useState({ quantityKg: String(Math.min(item.availableKg, 10)), offerPricePerKg: String(item.minPricePerKg), pickupDate: '', note: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const quantity = Number(form.quantityKg)
  const price = Number(form.offerPricePerKg)
  const problem = !(quantity >= 1) ? 'Offer for at least 1 kg.'
    : quantity > item.availableKg ? `Only ${item.availableKg} kg is available.`
    : !(price >= item.minPricePerKg) ? `KVIC's minimum for ${item.honeyType} is ₹${item.minPricePerKg} per kg.`
    : ''

  const send = async () => {
    setBusy(true); setError('')
    try {
      const { code } = await apiRequest('/trade/requests', { method: 'POST', body: JSON.stringify({ batchCode: item.batchCode, ...form }) })
      onSent(code)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-t-3xl bg-white p-6 sm:rounded-3xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-black">Offer for {item.honeyType}</h2>
            <p className="text-xs text-gray-500">{item.keeper.name} · {item.batchCode}</p>
          </div>
          <button onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <label className="text-sm font-semibold">Quantity (kg)
            <input type="number" min={1} max={item.availableKg} step="0.5" value={form.quantityKg} onChange={(event) => setForm({ ...form, quantityKg: event.target.value })} className="mt-1 w-full rounded-xl border border-[#c6e2e0] bg-[#f7fbfb] px-3 py-2.5" />
          </label>
          <label className="text-sm font-semibold">Price per kg (₹)
            <input type="number" min={item.minPricePerKg} value={form.offerPricePerKg} onChange={(event) => setForm({ ...form, offerPricePerKg: event.target.value })} className="mt-1 w-full rounded-xl border border-[#c6e2e0] bg-[#f7fbfb] px-3 py-2.5" />
          </label>
          <label className="text-sm font-semibold">Pickup date <span className="font-normal text-gray-400">(optional)</span>
            <input type="date" min={today} value={form.pickupDate} onChange={(event) => setForm({ ...form, pickupDate: event.target.value })} className="mt-1 w-full rounded-xl border border-[#c6e2e0] bg-[#f7fbfb] px-3 py-2.5" />
          </label>
          <div className="rounded-xl bg-[#f4fbfb] p-3 text-sm">
            <p className="text-xs font-semibold uppercase text-[#5d7f80]">Total</p>
            <p className="text-lg font-black">{quantity > 0 && price > 0 ? money.format(quantity * price) : '—'}</p>
          </div>
          <label className="col-span-2 text-sm font-semibold">Note to the beekeeper <span className="font-normal text-gray-400">(optional)</span>
            <textarea rows={2} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Containers, pickup, payment terms…" className="mt-1 w-full rounded-xl border border-[#c6e2e0] bg-[#f7fbfb] px-3 py-2.5" />
          </label>
        </div>
        <p className="mt-3 text-xs text-gray-500">If the beekeeper accepts, the sale is recorded in their books with a GST invoice in your company's name, and the hand-over is written to the Honey Chain ledger.</p>
        {(problem || error) && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-600">{error || problem}</p>}
        <button onClick={send} disabled={busy || Boolean(problem)} className="mt-4 w-full rounded-xl bg-[#0F766E] py-3 font-bold text-white disabled:opacity-50">{busy ? 'Sending…' : 'Send offer'}</button>
      </div>
    </div>
  )
}
