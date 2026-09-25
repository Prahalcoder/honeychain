import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, PackageCheck, Store, X } from 'lucide-react'

import { apiRequest } from '../lib/api'
import { formatDate, money } from '../lib/store'

const inputClass = 'mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[#F97360]'
const TONE = { PENDING: 'bg-orange-100 text-orange-800', ACCEPTING: 'bg-orange-100 text-orange-800', ACCEPTED: 'bg-teal-100 text-teal-800', DECLINED: 'bg-red-50 text-red-700', CANCELLED: 'bg-gray-100 text-gray-600' }
const LABEL = { PENDING: 'Waiting for you', ACCEPTING: 'Being accepted', ACCEPTED: 'Accepted', DECLINED: 'Declined', CANCELLED: 'Withdrawn by wholesaler' }
const EMPTY_FORM = { gstPercent: '0', paid: false, note: '', reason: '' }

// Offers from KVIC-approved wholesalers, who browse the Honey Chain market. Accepting one records a normal loose
// sale: the wholesaler becomes a buyer, a bill is made in their name, and the hand-over is sealed on the chain.
// Honey a wholesaler recorded as received from this keeper (the keeper confirmed by OTP). One whose harvest is
// not on record yet waits here: record the harvest, then attach it, and only then does the stock go down.
function WholesaleReceipts({ receipts, stock, onChanged, onBanner }) {
  const [choice, setChoice] = useState({})
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState('')
  if (!receipts.length) return null

  async function attach(receipt) {
    setBusy(receipt.code); setProblem('')
    try {
      const result = await apiRequest(`/company/trade-requests/receipts/${receipt.code}/attach`, { method: 'POST', body: JSON.stringify({ batchCode: choice[receipt.code] }) })
      onBanner(`Receipt ${result.code} completed from batch ${result.batchCode}: bill ${result.invoiceNumber} to ${receipt.trader.name}, recorded on the chain.`)
      await onChanged()
    } catch (err) { setProblem(err.message) } finally { setBusy('') }
  }

  return (
    <section className="rounded-2xl border border-[#c0dfdd] bg-white p-5">
      <h3 className="flex items-center gap-2 font-black"><PackageCheck size={18} /> Honey recorded by wholesalers</h3>
      <p className="mt-1 text-xs text-gray-500">A wholesaler recorded buying honey from you and you confirmed it with the OTP sent to your mobile. It is on the chain as "recorded by the wholesaler, confirmed by the keeper".</p>
      {problem && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-600">{problem}</p>}
      <div className="mt-3 grid gap-3">
        {receipts.map((receipt) => {
          const fits = stock.filter((batch) => batch.honeyType === receipt.honeyType && batch.availableKg >= receipt.quantityKg && batch.harvestDate <= receipt.receivedDate)
          return (
            <div key={receipt.code} className={`rounded-xl p-4 ${receipt.status === 'AWAITING_HARVEST' ? 'border border-orange-200 bg-orange-50' : 'bg-[#f4fbfb]'}`}>
              <p className="font-bold">{receipt.quantityKg} kg {receipt.honeyType} to {receipt.trader.name} · {money.format(receipt.totalInr)}</p>
              <p className="text-xs text-gray-500">Received {formatDate(receipt.receivedDate)} · {receipt.code}{receipt.batchCode ? ` · batch ${receipt.batchCode}` : ''}{receipt.invoiceNumber ? ` · bill ${receipt.invoiceNumber}` : ''}</p>
              {receipt.status === 'AWAITING_HARVEST' && (
                fits.length ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <select value={choice[receipt.code] || ''} onChange={(event) => setChoice({ ...choice, [receipt.code]: event.target.value })} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm">
                      <option value="">Choose the harvest (batch)</option>
                      {fits.map((batch) => <option key={batch.batchCode} value={batch.batchCode}>{batch.batchCode} · {batch.availableKg} kg left · {formatDate(batch.harvestDate)}</option>)}
                    </select>
                    <button disabled={!choice[receipt.code] || busy === receipt.code} onClick={() => attach(receipt)} className="rounded-xl bg-[#0F766E] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy === receipt.code ? 'Attaching…' : 'Attach and complete'}</button>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-orange-900">
                    No recorded harvest of {receipt.honeyType} has {receipt.quantityKg} kg left (harvested on or before {formatDate(receipt.receivedDate)}). <Link to="/harvest" className="font-bold underline">Record the harvest first</Link>, then attach it here.
                  </p>
                )
              )}
              {receipt.status === 'COMPLETED' && <p className="mt-1 text-xs font-semibold text-teal-700">Completed · on the chain</p>}
            </div>
          )
        })}
      </div>
    </section>
  )
}

export default function WholesaleOffers({ offers, receipts = [], stock = [], error, onChanged, onBanner }) {
  const [accepting, setAccepting] = useState(null)
  const [declining, setDeclining] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')

  const close = () => { setAccepting(null); setDeclining(null); setProblem(''); setForm(EMPTY_FORM) }

  async function accept() {
    setBusy(true); setProblem('')
    try {
      const sale = await apiRequest(`/company/trade-requests/${accepting.code}/accept`, { method: 'POST', body: JSON.stringify({ gstPercent: Number(form.gstPercent), paid: form.paid, note: form.note }) })
      onBanner(`Offer accepted: sale ${sale.code}, bill ${sale.invoiceNumber} for ${money.format(sale.totalInr)} to ${accepting.trader.name}.`)
      close(); await onChanged()
    } catch (err) { setProblem(err.message) } finally { setBusy(false) }
  }

  async function decline() {
    setBusy(true); setProblem('')
    try {
      await apiRequest(`/company/trade-requests/${declining.code}/decline`, { method: 'POST', body: JSON.stringify({ reason: form.reason }) })
      onBanner(`Offer from ${declining.trader.name} declined.`)
      close(); await onChanged()
    } catch (err) { setProblem(err.message) } finally { setBusy(false) }
  }

  if (error) return <p className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>
  if (!offers) return <p className="mt-5 text-sm text-gray-500">Loading offers…</p>

  return (
    <div className="mt-5 space-y-4">
      <WholesaleReceipts receipts={receipts} stock={stock} onChanged={onChanged} onBanner={onBanner} />
      {offers.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[#c0dfdd] bg-white p-10 text-center">
          <Store className="mx-auto text-[#0F766E]" size={40} />
          <p className="mt-3 font-black">No wholesale offers yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">Registered wholesalers see the loose honey left in your batches and can offer to buy it at or above the KVIC minimum price. Lab-verified batches get more offers.</p>
        </div>
      )}

      {offers.map((offer) => (
        <article key={offer.code} className="rounded-2xl border border-[#c0dfdd] bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-black">{offer.quantityKg} kg {offer.honeyType} at ₹{offer.offerPricePerKg}/kg · {money.format(offer.offerTotal)}</p>
              <p className="text-sm font-semibold text-[#0F766E]">{offer.trader.name}{offer.trader.brandName ? ` (${offer.trader.brandName})` : ''}</p>
              <p className="text-xs text-gray-500">{[offer.trader.businessType, offer.trader.district, offer.trader.state].filter(Boolean).join(' · ')}</p>
              <p className="mt-1 font-mono text-[11px] text-gray-400">GSTIN {offer.trader.gstin} · FSSAI {offer.trader.fssai} · NBB {offer.trader.registrationNo}</p>
              <p className="mt-1 font-mono text-[11px] text-gray-400">{offer.code} · batch {offer.batchCode} · {formatDate(offer.createdAt)}{offer.pickupDate ? ` · pickup ${formatDate(offer.pickupDate)}` : ''}</p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${TONE[offer.status] || TONE.CANCELLED}`}>{LABEL[offer.status] || offer.status}</span>
          </div>
          {offer.note && <p className="mt-3 rounded-xl bg-[#f4fbfb] p-3 text-sm">Wholesaler's note: {offer.note}</p>}
          {offer.decidedNote && offer.status !== 'PENDING' && <p className="mt-2 text-sm text-gray-500">Note: {offer.decidedNote}</p>}
          {offer.status === 'ACCEPTED' && (
            <p className="mt-2 text-sm text-gray-600">
              Bill {offer.invoiceNumber} · sale {offer.saleCode}
              {offer.trader.phone && <> · call <a className="font-bold text-[#0F766E]" href={`tel:${offer.trader.phone}`}>{offer.trader.phone}</a></>}
            </p>
          )}
          {offer.status === 'PENDING' && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => { close(); setAccepting(offer) }} className="flex items-center gap-2 rounded-xl bg-[#0F766E] px-4 py-2 text-sm font-bold text-white"><CheckCircle2 size={16} /> Accept</button>
              <button onClick={() => { close(); setDeclining(offer) }} className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold"><X size={16} /> Decline</button>
              {offer.trader.phone && <a href={`tel:${offer.trader.phone}`} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold">Call {offer.trader.phone}</a>}
            </div>
          )}
        </article>
      ))}

      {(accepting || declining) && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-t-3xl bg-white p-6 sm:rounded-3xl">
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-black">{accepting ? 'Accept this offer?' : 'Decline this offer?'}</h2>
              <button onClick={close} aria-label="Close"><X size={20} /></button>
            </div>
            {accepting ? (
              <>
                <p className="mt-2 text-sm text-gray-600">{accepting.quantityKg} kg of {accepting.honeyType} ({accepting.batchCode}) to {accepting.trader.name} for {money.format(accepting.offerTotal)} before GST. A bill in their name is created and the honey leaves your batch.</p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <label className="text-sm font-semibold">GST
                    <select value={form.gstPercent} onChange={(event) => setForm({ ...form, gstPercent: event.target.value })} className={inputClass}>
                      <option value="0">No GST (0%)</option>
                      <option value="5">5%</option>
                    </select>
                  </label>
                  <label className="flex items-end gap-2 pb-3 text-sm font-semibold"><input type="checkbox" checked={form.paid} onChange={(event) => setForm({ ...form, paid: event.target.checked })} /> Already paid</label>
                  <label className="col-span-2 text-sm font-semibold">Note to the wholesaler <span className="font-normal text-gray-400">(optional)</span>
                    <input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="e.g. ready for pickup at the apiary gate" className={inputClass} />
                  </label>
                </div>
              </>
            ) : (
              <label className="mt-4 block text-sm font-semibold">Reason <span className="font-normal text-gray-400">(the wholesaler sees this)</span>
                <input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="e.g. price too low, already sold" className={inputClass} />
              </label>
            )}
            {problem && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-600">{problem}</p>}
            <button onClick={accepting ? accept : decline} disabled={busy} className={`mt-5 w-full rounded-xl py-3 font-bold disabled:opacity-60 ${accepting ? 'bg-[#0F766E] text-white' : 'bg-[#F97360] text-[#14272e]'}`}>
              {busy ? 'Please wait…' : accepting ? 'Accept and create bill' : 'Decline offer'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
