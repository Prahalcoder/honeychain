import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Lock, MessageCircle, Plus, Send, ShieldCheck } from 'lucide-react'

import { apiRequest } from '../lib/api'

const when = (value) => new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
const LEVEL_TONE = { REGIONAL: 'bg-teal-50 text-teal-700', STATE: 'bg-blue-50 text-blue-700', CENTRAL: 'bg-orange-50 text-orange-700' }

// Help desk for keepers: every question is a ticket, a conversation with the regional officer.
export default function TicketDesk() {
  const [tickets, setTickets] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(() => apiRequest('/company/tickets').then(setTickets).catch(() => setTickets([])), [])

  useEffect(() => {
    load()
    const timer = window.setInterval(load, 15000)
    return () => window.clearInterval(timer)
  }, [load])

  if (openId) return <Thread id={openId} onBack={() => { setOpenId(null); load() }} />

  return (
    <div className="rounded-3xl border border-[#cfe8e5] bg-white p-6 shadow-[0_16px_40px_rgba(15,118,110,0.1)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-black"><MessageCircle className="text-[#F97360]" size={22} />Your tickets</h2>
          <p className="mt-1 text-sm text-gray-500">Each question becomes a ticket, a private conversation with your regional officer. Only they can read and answer it, and only they can close it.</p>
        </div>
        <button onClick={() => setCreating(!creating)} className="flex shrink-0 items-center gap-2 rounded-xl bg-[#F97360] px-4 py-2.5 text-sm font-black text-[#3b0d05]"><Plus size={16} />New ticket</button>
      </div>

      {creating && <NewTicket onDone={(created) => { setCreating(false); load(); setOpenId(created.id) }} />}

      <div className="mt-5 space-y-3">
        {tickets === null && <p className="text-sm text-gray-400">Loading…</p>}
        {tickets && tickets.length === 0 && !creating && <p className="rounded-2xl border border-dashed border-[#cfe8e5] p-6 text-center text-sm text-gray-500">You have no tickets yet. Press “New ticket” to ask your regional officer something.</p>}
        {(tickets || []).map((ticket) => (
          <button key={ticket.id} onClick={() => setOpenId(ticket.id)} className="block w-full rounded-2xl border border-[#cfe8e5] p-4 text-left transition hover:border-[#0F766E] hover:bg-[#f2faf9]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{ticket.code}</p>
                <p className="truncate font-black">{ticket.unread && <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-[#F97360]" />}{ticket.subject}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-black ${ticket.status === 'CLOSED' ? 'bg-gray-100 text-gray-600' : 'bg-teal-100 text-teal-800'}`}>{ticket.status === 'CLOSED' ? 'Closed' : 'Open'}</span>
            </div>
            {ticket.lastMessage && <p className="mt-1 line-clamp-1 text-sm text-gray-500">{ticket.lastMessage.from === 'KEEPER' ? 'You: ' : ''}{ticket.lastMessage.body}</p>}
            <p className="mt-1 text-[11px] text-gray-400">Updated {when(ticket.updatedAt)}</p>
          </button>
        ))}
      </div>
    </div>
  )
}

function NewTicket({ onDone }) {
  const [form, setForm] = useState({ subject: '', message: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      onDone(await apiRequest('/company/tickets', { method: 'POST', body: JSON.stringify(form) }))
    } catch (submitError) {
      setError(submitError.message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 rounded-2xl border border-[#cfe8e5] bg-[#f2faf9] p-4">
      <label className="block text-sm font-bold">Subject
        <input value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} required minLength={3} maxLength={120} className="mt-1 w-full rounded-xl border border-[#cfe8e5] bg-white px-3 py-2.5 font-normal outline-none focus:border-[#0F766E]" />
      </label>
      <label className="mt-3 block text-sm font-bold">Your question
        <textarea value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} required minLength={5} maxLength={1500} rows={4} className="mt-1 w-full rounded-xl border border-[#cfe8e5] bg-white px-3 py-2.5 font-normal outline-none focus:border-[#0F766E]" />
      </label>
      {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
      <button disabled={busy} className="mt-3 flex items-center gap-2 rounded-xl bg-[#0F766E] px-5 py-2.5 font-black text-white disabled:opacity-60"><Send size={16} />{busy ? 'Sending…' : 'Open ticket'}</button>
    </form>
  )
}

function Thread({ id, onBack }) {
  const [ticket, setTicket] = useState(null)
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const bottom = useRef(null)

  const load = useCallback(() => apiRequest(`/company/tickets/${id}`).then(setTicket).catch((loadError) => setError(loadError.message)), [id])

  useEffect(() => {
    load()
    const timer = window.setInterval(load, 8000)
    return () => window.clearInterval(timer)
  }, [load])

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }) }, [ticket?.messages.length])

  async function send(event) {
    event.preventDefault()
    if (!body.trim()) return
    setBusy(true)
    setError('')
    try {
      await apiRequest(`/company/tickets/${id}/messages`, { method: 'POST', body: JSON.stringify({ body }) })
      setBody('')
      await load()
    } catch (sendError) { setError(sendError.message) }
    setBusy(false)
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-[#cfe8e5] bg-white shadow-[0_16px_40px_rgba(15,118,110,0.1)]">
      <div className="flex items-center gap-3 bg-gradient-to-r from-[#0F766E] to-[#2563EB] px-5 py-4 text-white">
        <button onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full bg-white/20" aria-label="Back to tickets"><ArrowLeft size={18} /></button>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-white/70">{ticket?.code}</p>
          <p className="truncate font-black">{ticket?.subject || 'Loading…'}</p>
        </div>
        {ticket && <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-black">{ticket.status === 'CLOSED' ? 'Closed' : 'Open'}</span>}
      </div>

      {ticket && ticket.level !== 'REGIONAL' && (
        <p className={`flex items-center gap-2 px-5 py-2 text-xs font-bold ${LEVEL_TONE[ticket.level]}`}><ShieldCheck size={14} />Being looked at by the {ticket.levelLabel.toLowerCase()}. Keep writing to your regional officer.</p>
      )}

      <div className="max-h-[420px] min-h-[240px] space-y-3 overflow-y-auto bg-[#f7fbfb] p-5">
        {(ticket?.messages || []).map((message) => {
          if (message.event) return <p key={message.id} className="mx-auto w-fit max-w-[90%] rounded-full bg-orange-50 px-4 py-1.5 text-center text-xs font-semibold text-orange-800">{message.body}</p>
          const mine = message.from === 'KEEPER'
          return (
            <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${mine ? 'rounded-br-md bg-[#0F766E] text-white' : 'rounded-bl-md border border-[#bfdbfe] bg-white text-[#12303a]'}`}>
                {!mine && <p className="text-[11px] font-black text-[#2563EB]">{message.name || 'Regional officer'}</p>}
                <p className="whitespace-pre-line">{message.body}</p>
                <p className={`mt-1 text-[10px] ${mine ? 'text-white/70' : 'text-gray-400'}`}>{when(message.at)}</p>
              </div>
            </div>
          )
        })}
        <div ref={bottom} />
      </div>

      {ticket?.status === 'CLOSED' ? (
        <p className="flex items-center gap-2 border-t border-[#cfe8e5] bg-gray-50 px-5 py-4 text-sm text-gray-600"><Lock size={16} />Your regional officer closed this ticket. If you still need help, open a new ticket.</p>
      ) : (
        <form onSubmit={send} className="border-t border-[#cfe8e5] p-4">
          {error && <p className="mb-2 rounded-lg bg-red-50 p-2 text-sm font-semibold text-red-700">{error}</p>}
          <div className="flex gap-3">
            <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={2} maxLength={1500} placeholder="Write to your regional officer…" className="flex-1 resize-none rounded-xl border border-[#cfe8e5] px-3 py-2.5 text-sm outline-none focus:border-[#0F766E]" />
            <button disabled={busy || !body.trim()} className="grid w-12 place-items-center rounded-xl bg-[#0F766E] text-white disabled:opacity-50" aria-label="Send"><Send size={18} /></button>
          </div>
          <p className="mt-2 text-[11px] text-gray-400">Text only. Only your regional officer can read this and only they can close the ticket.</p>
        </form>
      )}
    </div>
  )
}
