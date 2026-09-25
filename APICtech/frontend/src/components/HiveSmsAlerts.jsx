import { useCallback, useEffect, useState } from 'react'
import { BellRing, Link2, MessageSquare, Send, Unlink } from 'lucide-react'

import { API_URL, BEEHIVE_API_URL, apiRequest } from '../lib/api'
import { formatDate } from '../lib/store'

// Hive-health alerts by SMS, with no GSM module on the hive: the monitor's hive-health analysis reports a problem
// to the Honey Chain API, which texts the keeper through an SMS API. Here the keeper links the monitor to this
// hive, turns SMS on or off, sends a test message and sees what was reported.
const SMS_LABELS = {
  SENT: 'SMS sent',
  DRY_RUN: 'SMS logged (no SMS provider set up yet)',
  FAILED: 'SMS failed',
  SKIPPED: 'No SMS',
  COOLDOWN: 'Already texted recently',
}
const LEVEL_TONES = { HIGH: 'bg-red-50 text-red-700', MEDIUM: 'bg-orange-50 text-orange-700', LOW: 'bg-blue-50 text-blue-700' }

async function monitor(path, options = {}) {
  const response = await fetch(`${BEEHIVE_API_URL}${path}`, { headers: { 'Content-Type': 'application/json' }, ...options })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.message || 'The hive monitor did not answer')
  return result
}

// Links the hive monitor to this hive (called from the button and when the keeper connects the ESP32 here).
export async function linkMonitorToHive(hiveId) {
  const { token } = await apiRequest(`/company/hives/${encodeURIComponent(hiveId)}/monitor-link`, { method: 'POST' })
  await monitor('/alerts/link', { method: 'POST', body: JSON.stringify({ token, hive_code: hiveId, api_url: API_URL }) })
}

export default function HiveSmsAlerts({ hiveId }) {
  const [overview, setOverview] = useState(null)
  const [link, setLink] = useState(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try { setOverview(await apiRequest('/company/hive-alerts')) } catch (err) { setMessage(err.message) }
    try { setLink(await monitor('/alerts/link')) } catch { setLink({ unreachable: true }) }
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(load, 30000)
    return () => clearInterval(timer)
  }, [load])

  const run = async (name, action) => {
    setBusy(name); setMessage('')
    try { await action() } catch (err) { setMessage(err.message) } finally { setBusy(''); load() }
  }

  if (!overview) return null
  const { sms } = overview
  const linkedHere = link?.linked && link.hive_code === hiveId
  const alerts = overview.alerts.filter((alert) => alert.hiveCode === hiveId).slice(0, 8)

  return (
    <section className="mt-6 rounded-2xl border border-[#c0dfdd] bg-white p-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-black"><BellRing size={19} /> SMS alerts · {hiveId}</h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">No SIM card on the hive: when the AI hive-health check finds a serious problem, Honey Chain texts you through an SMS service. The same problem is texted at most once every {sms.cooldownHours} hours.</p>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-[#c0dfdd] px-3 py-2 text-sm font-bold">
          <input type="checkbox" checked={sms.enabled} disabled={busy === 'toggle'} onChange={(event) => run('toggle', async () => apiRequest('/company/hive-alerts/sms', { method: 'PUT', body: JSON.stringify({ enabled: event.target.checked }) }))} />
          SMS alerts {sms.enabled ? 'on' : 'off'}
        </label>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl bg-[#f4fbfb] p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#5d7f80]">Texts go to</p>
          <p className="mt-1 text-sm font-bold">{sms.hasMobile ? `+91 ${sms.to}` : 'No mobile number'}</p>
          {!sms.hasMobile && <p className="mt-1 text-xs text-orange-700">Add it in Settings &gt; Profile.</p>}
        </div>
        <div className="rounded-xl bg-[#f4fbfb] p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#5d7f80]">Hive monitor</p>
          <p className="mt-1 text-sm font-bold">{link?.unreachable ? 'Not reachable' : linkedHere ? 'Linked to this hive' : link?.linked ? `Linked to ${link.hive_code}` : 'Not linked'}</p>
          {link?.worker?.message && <p className="mt-1 text-xs text-gray-500">{link.worker.message}</p>}
        </div>
        <div className="rounded-xl bg-[#f4fbfb] p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#5d7f80]">SMS service</p>
          <p className="mt-1 text-sm font-bold">{sms.provider}</p>
          {sms.provider.startsWith('none') && <p className="mt-1 text-xs text-gray-500">Messages are saved in the server's outbox until an SMS API key is set.</p>}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {!linkedHere && !link?.unreachable && (
          <button onClick={() => run('link', () => linkMonitorToHive(hiveId))} disabled={Boolean(busy)} className="flex items-center gap-2 rounded-xl bg-[#0F766E] px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
            <Link2 size={16} /> {busy === 'link' ? 'Linking…' : `Send this monitor's alerts for ${hiveId}`}
          </button>
        )}
        {linkedHere && (
          <button onClick={() => run('unlink', async () => { await apiRequest(`/company/hives/${encodeURIComponent(hiveId)}/monitor-link`, { method: 'DELETE' }); await monitor('/alerts/link', { method: 'DELETE' }) })} disabled={Boolean(busy)} className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold disabled:opacity-60">
            <Unlink size={16} /> Stop alerts from this monitor
          </button>
        )}
        <button onClick={() => run('test', async () => { const result = await apiRequest('/company/hive-alerts/test-sms', { method: 'POST' }); setMessage(result.status === 'SENT' ? `Test SMS sent to +91 ${result.to}.` : `Test SMS logged for +91 ${result.to} (no SMS service set up yet).`) })} disabled={Boolean(busy) || !sms.hasMobile} className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold disabled:opacity-60">
          <Send size={16} /> {busy === 'test' ? 'Sending…' : 'Send a test SMS'}
        </button>
      </div>
      {message && <p className="mt-3 rounded-xl bg-[#e6f3f2] p-3 text-sm text-[#0F766E]">{message}</p>}

      <h3 className="mt-5 flex items-center gap-2 text-sm font-black"><MessageSquare size={16} /> Recent alerts for {hiveId}</h3>
      {alerts.length === 0
        ? <p className="mt-2 text-sm text-gray-500">No problems reported for this hive yet.</p>
        : <div className="mt-2 grid gap-2">{alerts.map((alert) => (
          <div key={alert.id} className={`rounded-xl p-3 text-sm ${LEVEL_TONES[alert.level] || 'bg-gray-50'}`}>
            <p className="font-bold">{alert.riskName} <span className="text-[11px] opacity-70">{alert.level}{alert.score !== null ? ` · health ${alert.score}/100` : ''}</span></p>
            {alert.action && <p className="mt-0.5 text-xs">→ {alert.action}</p>}
            <p className="mt-1 text-[11px] opacity-80">{formatDate(alert.createdAt)} {new Date(alert.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} · {SMS_LABELS[alert.smsStatus] || alert.smsStatus}{alert.smsTo ? ` to ${alert.smsTo}` : ''}{alert.smsError ? ` (${alert.smsError})` : ''}</p>
          </div>
        ))}</div>}
    </section>
  )
}
