import { useEffect, useState } from 'react'
import { CheckCircle2, PackageCheck, ShieldCheck } from 'lucide-react'

import TradeLayout, { useTradeSummary } from '../../layouts/TradeLayout'
import { apiRequest } from '../../lib/api'
import { formatDate, money } from '../../lib/store'

const inputClass = 'mt-1 w-full rounded-xl border border-[#c6e2e0] bg-[#f7fbfb] px-3 py-2.5 text-sm outline-none focus:border-[#F97360]'
const today = () => new Date().toLocaleDateString('en-CA')
const EMPTY = { keeperPhone: '', keeperName: '', honeyType: '', quantityKg: '', pricePerKg: '', receivedDate: today(), batchCode: '', note: '' }
const STATUS = {
  OTP_SENT: ['Waiting for the keeper\'s OTP', 'bg-orange-50 text-orange-800'],
  AWAITING_HARVEST: ['Confirmed · keeper must record the harvest', 'bg-blue-50 text-blue-800'],
  COMPLETED: ['Completed · on the chain', 'bg-[#e6f3f2] text-[#0F766E]'],
  CANCELLED: ['Withdrawn', 'bg-gray-100 text-gray-500'],
}

// Honey received from a beekeeper who did not record the sale: the wholesaler records it here, the keeper
// confirms by giving the OTP sent to their registered mobile, and the hand-over goes on the chain marked
// "recorded by the wholesaler, confirmed by the keeper".
export default function Receipts() {
  const trade = useTradeSummary()
  const approved = trade.summary?.organization.status === 'APPROVED'
  const [form, setForm] = useState(EMPTY)
  const [pending, setPending] = useState(null)
  const [otp, setOtp] = useState('')
  const [list, setList] = useState(null)
  const [message, setMessage] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => { try { setList(await apiRequest('/trade/receipts')) } catch (err) { setError(err.message) } }
  useEffect(() => { if (approved) load() }, [approved])

  const set = (field) => (event) => setForm({ ...form, [field]: event.target.value })

  async function start(event) {
    event.preventDefault()
    setBusy(true); setError(''); setMessage(null)
    try {
      const result = await apiRequest('/trade/receipts', { method: 'POST', body: JSON.stringify(form) })
      setPending({ ...result, quantityKg: form.quantityKg, honeyType: form.honeyType })
      setOtp('')
      load()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  async function confirm(event) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const result = await apiRequest(`/trade/receipts/${pending.code}/confirm`, { method: 'POST', body: JSON.stringify({ otp }) })
      setMessage(result.status === 'COMPLETED'
        ? { tone: 'ok', text: `Receipt ${result.code} confirmed and completed: taken from the keeper's batch ${result.batchCode}, bill ${result.invoiceNumber}, recorded on the chain.` }
        : { tone: 'info', text: `Receipt ${result.code} confirmed. The keeper has not recorded this harvest yet; they have been asked to record it, and the receipt completes when they attach it.` })
      setPending(null); setForm(EMPTY)
      load()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  async function act(code, action) {
    setBusy(true); setError('')
    try {
      const result = await apiRequest(`/trade/receipts/${code}/${action}`, { method: 'POST' })
      if (action === 'resend') setPending((current) => current && { ...current, otp: result })
      if (action === 'cancel' && pending?.code === code) setPending(null)
      load()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <TradeLayout title="Received honey" trade={trade}>
      <p className="mb-5 max-w-3xl text-sm text-gray-600">
        Bought honey from a beekeeper who has not recorded the sale in Honey Chain? Record it here. The beekeeper receives an OTP on their registered mobile and gives it to you only if the receipt is true. The hand-over is then written to the blockchain as <b>recorded by the wholesaler, confirmed by the keeper</b>, so the honey stays traceable.
      </p>

      {message && <p className={`mb-4 flex items-start gap-2 rounded-xl p-3 text-sm ${message.tone === 'ok' ? 'bg-[#e6f3f2] text-[#0F766E]' : 'bg-blue-50 text-blue-800'}`}><CheckCircle2 size={18} className="mt-0.5 shrink-0" />{message.text}</p>}
      {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      {!pending ? (
        <form onSubmit={start} className="grid gap-4 rounded-2xl border border-[#c0dfdd] bg-white p-5 md:grid-cols-2">
          <h2 className="flex items-center gap-2 text-lg font-black md:col-span-2"><PackageCheck size={20} /> Record honey received</h2>
          <label className="text-sm font-semibold">Beekeeper's registered mobile
            <input value={form.keeperPhone} onChange={set('keeperPhone')} inputMode="numeric" placeholder="9876543210" className={inputClass} required />
          </label>
          <label className="text-sm font-semibold">Beekeeper's name (or farm name)
            <input value={form.keeperName} onChange={set('keeperName')} placeholder="As registered" className={inputClass} required />
          </label>
          <label className="text-sm font-semibold">Honey type
            <select value={form.honeyType} onChange={set('honeyType')} className={inputClass} required>
              <option value="">Select</option>
              {(trade.summary?.filters.honeyTypes || []).map((type) => <option key={type}>{type}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold">Date received
            <input type="date" value={form.receivedDate} max={today()} onChange={set('receivedDate')} className={inputClass} required />
          </label>
          <label className="text-sm font-semibold">Quantity received (kg)
            <input type="number" min={1} step="0.5" value={form.quantityKg} onChange={set('quantityKg')} className={inputClass} required />
          </label>
          <label className="text-sm font-semibold">Price per kg (₹) <span className="font-normal text-gray-400">(at least the KVIC minimum)</span>
            <input type="number" min={1} value={form.pricePerKg} onChange={set('pricePerKg')} className={inputClass} required />
          </label>
          <label className="text-sm font-semibold">Keeper's batch number <span className="font-normal text-gray-400">(optional, if you know it)</span>
            <input value={form.batchCode} onChange={set('batchCode')} placeholder="HC-..." className={inputClass} />
          </label>
          <label className="text-sm font-semibold">Note <span className="font-normal text-gray-400">(optional)</span>
            <input value={form.note} onChange={set('note')} placeholder="e.g. collected at the apiary, 2 cans" className={inputClass} />
          </label>
          <button disabled={busy} className="rounded-xl bg-[#0F766E] py-3 text-sm font-bold text-white disabled:opacity-60 md:col-span-2">{busy ? 'Sending OTP…' : 'Send OTP to the beekeeper'}</button>
        </form>
      ) : (
        <form onSubmit={confirm} className="rounded-2xl border border-[#c0dfdd] bg-white p-5">
          <h2 className="flex items-center gap-2 text-lg font-black"><ShieldCheck size={20} /> Enter the beekeeper's OTP</h2>
          <p className="mt-1 text-sm text-gray-600">Receipt <b>{pending.code}</b>: {pending.quantityKg} kg of {pending.honeyType} from <b>{pending.keeper.name}</b> ({pending.keeper.region}, {pending.keeper.state}). The OTP was sent by SMS to <b>{pending.otp.to}</b>.</p>
          {pending.otp.demoOtp && <p className="mt-2 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">Demo mode (no SMS service connected yet): the keeper's OTP is <b className="font-mono text-base">{pending.otp.demoOtp}</b></p>}
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-sm font-semibold">OTP
              <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" className={`${inputClass} w-44 font-mono text-lg tracking-[0.3em]`} required />
            </label>
            <button disabled={busy || otp.length !== 6} className="rounded-xl bg-[#0F766E] px-6 py-3 text-sm font-bold text-white disabled:opacity-60">{busy ? 'Checking…' : 'Confirm receipt'}</button>
            <button type="button" disabled={busy} onClick={() => act(pending.code, 'resend')} className="rounded-xl border border-gray-200 px-4 py-3 text-sm font-bold disabled:opacity-60">Send a new OTP</button>
            <button type="button" disabled={busy} onClick={() => act(pending.code, 'cancel')} className="rounded-xl border border-gray-200 px-4 py-3 text-sm font-bold disabled:opacity-60">Withdraw</button>
          </div>
        </form>
      )}

      <h2 className="mb-3 mt-8 text-lg font-black">Your receipts</h2>
      {!list ? <p className="text-sm text-gray-500">Loading…</p> : list.length === 0 ? <p className="rounded-2xl border border-dashed border-[#c0dfdd] p-6 text-center text-sm text-gray-500">No receipts recorded yet.</p> : (
        <div className="grid gap-3">
          {list.map((row) => (
            <article key={row.code} className="rounded-2xl border border-[#c0dfdd] bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-black">{row.quantityKg} kg {row.honeyType} · {money.format(row.totalInr)}</p>
                  <p className="text-xs text-gray-500">from {row.keeper.name}, {row.keeper.region} · received {formatDate(row.receivedDate)}</p>
                  <p className="mt-1 font-mono text-[11px] text-gray-400">{row.code}{row.batchCode ? ` · batch ${row.batchCode}` : ''}{row.invoiceNumber ? ` · bill ${row.invoiceNumber}` : ''}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${(STATUS[row.status] || STATUS.CANCELLED)[1]}`}>{(STATUS[row.status] || [row.status])[0]}</span>
              </div>
              {row.status === 'OTP_SENT' && pending?.code !== row.code && (
                <div className="mt-3 flex gap-2">
                  <button onClick={() => { setPending({ code: row.code, quantityKg: row.quantityKg, honeyType: row.honeyType, keeper: row.keeper, otp: { to: 'the keeper\'s mobile' } }); act(row.code, 'resend') }} className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold">Send OTP again and continue</button>
                  <button onClick={() => act(row.code, 'cancel')} className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold">Withdraw</button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </TradeLayout>
  )
}
