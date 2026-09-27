import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellRing, CheckCircle2, X } from 'lucide-react'
import { apiRequest } from '../lib/api'

// Critical hive alerts reach the keeper on their own: the hive monitor has already sent the SMS (services/hiveAlerts.js),
// and while the app is open this watcher pops the alert up and shows a system notification, with no button to press.
// Only alerts newer than the last one this device has seen are shown, so old alerts do not pop up again.
const LAST_KEY = 'hc_last_hive_alert'
const POLL_MS = 20000

const readLast = () => { try { return Number(localStorage.getItem(LAST_KEY)) || 0 } catch { return 0 } }
const saveLast = (id) => { try { localStorage.setItem(LAST_KEY, String(id)) } catch { /* storage can be blocked */ } }
const canNotify = () => typeof window !== 'undefined' && 'Notification' in window

function smsLine(alert) {
  if (alert.smsStatus === 'SENT') return `SMS sent to ${alert.smsTo}`
  if (alert.smsStatus === 'DRY_RUN') return `SMS prepared for ${alert.smsTo} (demo mode, no SMS provider yet)`
  return alert.smsError ? `SMS not sent: ${alert.smsError}` : 'Shown in the app'
}

export default function AlertWatcher() {
  const navigate = useNavigate()
  const [popups, setPopups] = useState([])
  const last = useRef(null)

  // Browsers only allow the notification permission prompt after a tap or click.
  useEffect(() => {
    if (!canNotify() || Notification.permission !== 'default') return undefined
    const ask = () => { Notification.requestPermission().catch(() => {}); window.removeEventListener('click', ask) }
    window.addEventListener('click', ask)
    return () => window.removeEventListener('click', ask)
  }, [])

  useEffect(() => {
    let alive = true
    async function check() {
      try {
        const { alerts = [] } = await apiRequest('/company/hive-alerts')
        const newest = alerts.reduce((max, alert) => Math.max(max, alert.id), 0)
        if (last.current === null) {
          // First look on this device: remember where we are instead of popping up the whole history.
          last.current = readLast() || newest
          saveLast(last.current)
        }
        const fresh = alerts.filter((alert) => alert.id > last.current && alert.level === 'HIGH' && alert.smsStatus !== 'COOLDOWN').reverse()
        if (!alive || fresh.length === 0) return
        last.current = newest
        saveLast(newest)
        setPopups((current) => [...fresh, ...current].slice(0, 3))
        for (const alert of fresh) {
          if (canNotify() && Notification.permission === 'granted') {
            try { new Notification(`Critical: hive ${alert.hiveCode}`, { body: `${alert.riskName}. ${alert.action || ''}`, tag: `hive-alert-${alert.id}`, icon: '/icons/icon-192.png' }) } catch { /* some WebViews have no notifications */ }
          }
        }
      } catch { /* offline or signed out: try again on the next round */ }
    }
    check()
    const timer = window.setInterval(check, POLL_MS)
    return () => { alive = false; window.clearInterval(timer) }
  }, [])

  // Each pop-up closes itself after a minute.
  useEffect(() => {
    if (popups.length === 0) return undefined
    const timer = window.setTimeout(() => setPopups((current) => current.slice(0, -1)), 60000)
    return () => window.clearTimeout(timer)
  }, [popups])

  if (popups.length === 0) return null
  const close = (id) => setPopups((current) => current.filter((alert) => alert.id !== id))

  return <div className="fixed right-4 top-4 z-[70] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-3" role="alert" aria-live="assertive">
    {popups.map((alert) => <div key={alert.id} className="rounded-2xl border border-red-200 bg-white p-4 shadow-[0_18px_50px_rgba(127,29,29,0.18)]">
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-black text-red-700"><BellRing size={17} /> Critical hive alert · {alert.hiveCode}</p>
        <button onClick={() => close(alert.id)} aria-label="Close" className="text-gray-400 hover:text-gray-700"><X size={16} /></button>
      </div>
      <p className="mt-2 text-sm font-bold text-[#122c31]">{alert.riskName}</p>
      {alert.action && <p className="mt-1 text-xs leading-5 text-gray-600">{alert.action}</p>}
      <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-teal-800"><CheckCircle2 size={13} /> Sent automatically · {smsLine(alert)}</p>
      <button onClick={() => { close(alert.id); navigate(`/iot-monitoring/${alert.hiveCode}?tab=history`) }} className="mt-3 w-full rounded-xl bg-[#122c31] py-2 text-xs font-bold text-white">Open health log</button>
    </div>)}
  </div>
}
