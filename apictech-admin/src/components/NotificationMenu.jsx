import { useEffect, useRef, useState } from 'react'
import { Bell, ClipboardCheck, LifeBuoy, Megaphone, ScanSearch, Store } from 'lucide-react'

import { useLive } from '../api'
import { fmtDateTime } from '../ui'

const SEEN_KEY = 'hc_admin_seen_notices'
const ICONS = { requests: Store, inspection: ScanSearch, help: LifeBuoy, notice: Megaphone }

const readSeen = () => {
  try { return localStorage.getItem(SEEN_KEY) || '' } catch { return '' }
}

// The bell in the top bar: things waiting for a decision, and notices from other offices.
export default function NotificationMenu({ go }) {
  const feed = useLive('/admin/notifications', { interval: 10000 })
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(readSeen)
  const box = useRef(null)
  const items = feed.data || []

  useEffect(() => {
    if (!open) return undefined
    const close = (event) => { if (box.current && !box.current.contains(event.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const tasks = items.filter((item) => item.kind !== 'notice').length
  const unreadNotices = items.filter((item) => item.kind === 'notice' && String(item.time) > seen).length
  const badge = tasks + unreadNotices

  function toggle() {
    const next = !open
    setOpen(next)
    if (next) {
      const latest = items.filter((item) => item.kind === 'notice').reduce((max, item) => (String(item.time) > max ? String(item.time) : max), '')
      if (latest) {
        try { localStorage.setItem(SEEN_KEY, latest) } catch { /* ignore */ }
        window.setTimeout(() => setSeen(latest), 1500)
      }
    }
  }

  return (
    <div className="bell-wrap" ref={box}>
      <button className="icon-button notification" aria-label="Notifications" onClick={toggle}>
        <Bell size={19} />
        {badge > 0 && <span className="bell-badge">{badge > 9 ? '9+' : badge}</span>}
      </button>

      {open && (
        <div className="bell-panel">
          <div className="bell-head"><b>Notifications</b><button onClick={() => { setOpen(false); go('notices') }}>Open notice board</button></div>
          <div className="bell-list">
            {items.length === 0 && <p className="bell-empty"><ClipboardCheck size={22} />You are all caught up. Pending decisions and notices from other offices appear here.</p>}
            {items.map((item) => {
              const Icon = ICONS[item.kind] || Bell
              return (
                <button key={item.id} className="bell-item" onClick={() => { setOpen(false); go(item.go, item.params || {}) }}>
                  <span className={`bell-icon tone-${item.tone}`}><Icon size={16} /></span>
                  <span><b>{item.title}</b><small>{item.text}</small>{item.kind === 'notice' && <small>{fmtDateTime(item.time)}</small>}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
