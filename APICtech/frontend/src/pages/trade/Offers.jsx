import { useEffect, useState } from 'react'
import { Phone } from 'lucide-react'

import TradeLayout, { useTradeSummary } from '../../layouts/TradeLayout'
import { apiRequest } from '../../lib/api'
import { formatDate, money } from '../../lib/store'

const BADGE = {
  PENDING: 'bg-orange-50 text-orange-800',
  ACCEPTING: 'bg-orange-50 text-orange-800',
  ACCEPTED: 'bg-[#e6f3f2] text-[#0F766E]',
  DECLINED: 'bg-red-50 text-red-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
}
const LABEL = { PENDING: 'Waiting for the beekeeper', ACCEPTING: 'Being accepted', ACCEPTED: 'Accepted', DECLINED: 'Declined', CANCELLED: 'Withdrawn' }

// Every offer this wholesaler has made. Once accepted, the beekeeper's phone number is shown to arrange pickup.
export default function Offers() {
  const trade = useTradeSummary()
  const approved = trade.summary?.organization.status === 'APPROVED'
  const [offers, setOffers] = useState(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('ALL')

  const load = async () => {
    try { setOffers(await apiRequest('/trade/requests')); setError('') } catch (err) { setError(err.message) }
  }
  useEffect(() => {
    if (!approved) return undefined
    load()
    const timer = window.setInterval(load, 15000)
    return () => window.clearInterval(timer)
  }, [approved])

  const cancel = async (code) => {
    if (!window.confirm('Withdraw this offer?')) return
    try { await apiRequest(`/trade/requests/${code}/cancel`, { method: 'POST' }); await load(); trade.reload() } catch (err) { setError(err.message) }
  }

  const shown = (offers || []).filter((offer) => filter === 'ALL' || offer.status === filter)
  return (
    <TradeLayout title="My offers" trade={trade}>
      <div className="mb-4 flex flex-wrap gap-2">
        {['ALL', 'PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED'].map((item) => (
          <button key={item} onClick={() => setFilter(item)} className={`rounded-xl px-4 py-2 text-sm font-bold ${filter === item ? 'bg-[#0F766E] text-white' : 'border border-[#c0dfdd] bg-white text-gray-600'}`}>
            {item === 'ALL' ? 'All' : LABEL[item]}{offers ? ` (${item === 'ALL' ? offers.length : offers.filter((offer) => offer.status === item).length})` : ''}
          </button>
        ))}
      </div>
      {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>}
      {!offers && !error && <p className="text-sm text-gray-500">Loading…</p>}
      {offers && shown.length === 0 && <p className="rounded-2xl border border-dashed border-[#c0dfdd] p-8 text-center text-sm text-gray-500">No offers here yet. Browse the honey market to make one.</p>}

      <div className="grid gap-3">
        {shown.map((offer) => (
          <article key={offer.code} className="rounded-2xl border border-[#c0dfdd] bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-black">{offer.quantityKg} kg {offer.honeyType} · {money.format(offer.offerTotal)}</p>
                <p className="text-xs text-gray-500">₹{offer.offerPricePerKg}/kg · {offer.keeper.name}, {[offer.keeper.place, offer.keeper.region, offer.keeper.state].filter(Boolean).join(', ')}</p>
                <p className="mt-1 font-mono text-[11px] text-gray-400">{offer.code} · batch {offer.batchCode} · sent {formatDate(offer.createdAt)}{offer.pickupDate ? ` · pickup ${formatDate(offer.pickupDate)}` : ''}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${BADGE[offer.status] || BADGE.CANCELLED}`}>{LABEL[offer.status] || offer.status}</span>
            </div>
            {offer.note && <p className="mt-3 text-sm text-gray-600">Your note: {offer.note}</p>}
            {offer.decidedNote && <p className="mt-2 text-sm text-gray-600">Beekeeper: {offer.decidedNote}</p>}
            {offer.status === 'ACCEPTED' && (
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-[#e6f3f2] p-3 text-sm">
                <span>Invoice <b>{offer.invoiceNumber}</b> · sale {offer.saleCode}</span>
                {offer.keeper.phone && <a href={`tel:${offer.keeper.phone}`} className="flex items-center gap-1 font-bold text-[#0F766E]"><Phone size={14} /> {offer.keeper.phone}</a>}
              </div>
            )}
            {offer.status === 'PENDING' && (
              <button onClick={() => cancel(offer.code)} className="mt-3 rounded-xl border border-gray-200 px-4 py-2 text-xs font-bold hover:bg-gray-50">Withdraw offer</button>
            )}
          </article>
        ))}
      </div>
    </TradeLayout>
  )
}
