import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, ClipboardCheck, FlaskConical, LifeBuoy, Megaphone, Store } from 'lucide-react'

import { apiRequest } from '../lib/api'

const SEEN_KEY = 'hc_seen_notifications'
const ICONS = { lab: FlaskConical, organization: Store, inspection: ClipboardCheck, announcement: Megaphone, support: LifeBuoy }
const TONES = { lab: 'bg-blue-50 text-blue-600', organization: 'bg-teal-50 text-teal-600', inspection: 'bg-orange-50 text-orange-600', announcement: 'bg-rose-50 text-rose-600', support: 'bg-violet-50 text-violet-600' }

const readSeen = () => {
  try { return localStorage.getItem(SEEN_KEY) || '' } catch { return '' }
}

const when = (value) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// The bell in the top bar: latest notices, decisions and reminders, with a count of what is new.
export default function NotificationBell() {
  const [items, setItems] = useState([])
  const [seen, setSeen] = useState(readSeen)
  const [open, setOpen] = useState(false)
  const box = useRef(null)

  useEffect(() => {
    let alive = true
    const load = () => apiRequest('/company/notifications').then((data) => { if (alive) setItems(data) }).catch(() => {})
    load()
    const timer = window.setInterval(load, 30000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const close = (event) => { if (box.current && !box.current.contains(event.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const unread = items.filter((item) => String(item.time) > seen).length

  function toggle() {
    const next = !open
    setOpen(next)
    if (next && items[0]) {
      const latest = items.reduce((max, item) => (String(item.time) > max ? String(item.time) : max), '')
      try { localStorage.setItem(SEEN_KEY, latest) } catch { /* ignore */ }
      window.setTimeout(() => setSeen(latest), 1200)
    }
  }

  return (
    <div className="relative" ref={box}>
      <button onClick={toggle} aria-label="Notifications" className="relative rounded-xl p-2.5 text-[#3a5c5f] transition hover:bg-[#d7eae9]">
        <Bell size={20} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-[#ff5a3c] px-1 text-[11px] font-black leading-none text-white shadow">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-[#c0dedc] bg-white shadow-[0_24px_60px_rgba(25,58,65,0.22)]">
          <div className="flex items-center justify-between bg-gradient-to-r from-[#f86751] to-[#0F766E] px-4 py-3">
            <p className="font-black text-[#10262a]">Notifications</p>
            <Link to="/notifications" onClick={() => setOpen(false)} className="text-xs font-bold text-[#10262a] underline">View all</Link>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {items.length === 0 && <p className="p-6 text-center text-sm text-gray-500">You are all caught up. Decisions, notices and reminders appear here.</p>}
            {items.slice(0, 8).map((item) => {
              const Icon = ICONS[item.type] || Bell
              return (
                <Link key={item.id} to={item.type === 'inspection' ? '/inspections' : '/notifications'} onClick={() => setOpen(false)} className="flex gap-3 border-b border-gray-50 px-4 py-3 hover:bg-[#f4fbfb]">
                  <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${TONES[item.type] || 'bg-gray-100 text-gray-600'}`}><Icon size={17} /></span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold leading-snug text-[#122c31]">{item.title}</span>
                    <span className="mt-0.5 line-clamp-2 block text-xs text-gray-500">{item.message}</span>
                    <span className="mt-1 block text-[11px] text-gray-400">{when(item.time)}</span>
                  </span>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
