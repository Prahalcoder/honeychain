import { useMemo, useState } from 'react'
import {
  AudioLines, BellRing, CheckCircle2, Crown, Download, Droplets, Hexagon, Info, MessageSquareText, Scale,
  Thermometer, ThermometerSun, TriangleAlert, Wind,
} from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useApi } from '../lib/store'
import { assess, demoHistory, spectrum, withNotifications } from '../lib/colonyDemo'

// The Colony Health tab and the Health Log tab of a hive page. Both use the demo history in lib/colonyDemo.js
// until the microphone and the extra sensors are installed; live readings replace the demo where the ESP32 has them.

const ICONS = { brood: Thermometer, thermo: ThermometerSun, humidity: Droplets, co2: Wind, weight: Scale, sound: AudioLines, queen: Crown, swarm: Hexagon }
const STATUS_TONE = {
  GOOD: 'border-teal-200 bg-teal-50 text-teal-800', HEALTHY: 'bg-teal-100 text-teal-800',
  WATCH: 'border-orange-200 bg-orange-50 text-orange-800', CRITICAL: 'border-red-200 bg-red-50 text-red-800',
}
const PILL = { GOOD: 'bg-teal-100 text-teal-800', HEALTHY: 'bg-teal-100 text-teal-800', WATCH: 'bg-orange-100 text-orange-800', CRITICAL: 'bg-red-100 text-red-700' }
const LABEL = { GOOD: 'Good', HEALTHY: 'Healthy', WATCH: 'Watch', CRITICAL: 'Critical' }

const clock = (value) => new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

function useHistory(hiveId) {
  return useMemo(() => withNotifications(demoHistory(hiveId)), [hiveId])
}

// The latest reading, with the live ESP32 values in place of the demo ones when the hive is connected.
function currentReading(history, telemetry) {
  const latest = { ...history[history.length - 1] }
  const live = []
  const number = (value) => (value === undefined || value === null || value === '' || Number.isNaN(Number(value)) ? null : Number(value))
  if (number(telemetry?.avg_temp) !== null) { latest.brood = number(telemetry.avg_temp); live.push('brood', 'thermo') }
  if (number(telemetry?.avg_hum) !== null) { latest.humidity = number(telemetry.avg_hum); live.push('humidity') }
  if (number(telemetry?.co2_ppm) !== null) { latest.co2 = number(telemetry.co2_ppm); live.push('co2') }
  if (number(telemetry?.weight_kg) !== null) { latest.weight = number(telemetry.weight_kg); live.push('weight') }
  return { reading: latest, live }
}

export function ColonyHealthTab({ hiveId, telemetry, onOpenLog }) {
  const history = useHistory(hiveId)
  const { reading, live } = currentReading(history, telemetry)
  const result = assess(reading)
  const recent = history.slice(-8)
  const criticalCount = history.filter((row) => row.notice === 'SENT').length

  return <div className="mt-6 space-y-6">
    <DemoBanner live={live} />

    <section className="rounded-2xl border border-[#c0dfdd] bg-white p-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-lg font-black">Colony health · {hiveId}</h2>
          <p className="mt-1 text-sm text-gray-500">The whole colony judged from 8 components: temperature, humidity, air, weight and the hive's sound.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right"><p className="text-4xl font-black leading-none">{result.score}</p><p className="text-[11px] text-gray-400">colony score / 100</p></div>
          <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${PILL[result.status]}`}>{LABEL[result.status]}</span>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-[#f4fbfb] p-3 text-xs text-gray-600">
        <span>Last 7 days: <b>{criticalCount}</b> critical events. Each one alerted the keeper automatically (SMS + app notification).</span>
        <button onClick={onOpenLog} className="rounded-lg border border-[#c0dfdd] bg-white px-3 py-1.5 font-bold text-[#0F766E]">Open health log</button>
      </div>
    </section>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {result.components.map((item) => <ComponentCard key={item.key} item={item} live={live.includes(item.key)} />)}
    </div>

    <div className="grid gap-5 xl:grid-cols-5">
      <section className="rounded-2xl border border-[#c0dfdd] bg-white p-5 xl:col-span-3">
        <h3 className="flex items-center gap-2 font-bold"><AudioLines size={18} /> Hive sound spectrum (microphone)</h3>
        <p className="mt-1 text-xs text-gray-500">INMP441 → digital filters keep 100-600 Hz (wind, rain and birds removed) → FFT. Peak now: <b>{reading.soundHz} Hz</b>. Normal hum is 200-300 Hz.</p>
        <div className="mt-4 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={spectrum(reading)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#dbeceb" vertical={false} />
              <ReferenceArea x1={200} x2={300} fill="#0F766E" fillOpacity={0.06} />
              <XAxis dataKey="hz" tick={{ fontSize: 10 }} unit=" Hz" />
              <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
              <Tooltip formatter={(value) => [`${value}`, 'Level']} labelFormatter={(hz) => `${hz} Hz`} />
              <Bar dataKey="level" radius={[3, 3, 0, 0]}>
                {spectrum(reading).map((bin) => <Cell key={bin.hz} fill={Math.abs(bin.hz - reading.soundHz) <= 25 ? '#F97360' : '#0F766E'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section className="rounded-2xl border border-[#c0dfdd] bg-white p-5 xl:col-span-2">
        <h3 className="font-bold">Score, last 24 hours</h3>
        <div className="mt-3 space-y-2">
          {recent.map((row) => <div key={row.time} className="flex items-center gap-3 text-xs">
            <span className="w-24 shrink-0 text-gray-500">{clock(row.time)}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100"><div className={`h-full ${row.status === 'CRITICAL' ? 'bg-red-500' : row.status === 'WATCH' ? 'bg-orange-400' : 'bg-teal-500'}`} style={{ width: `${row.score}%` }} /></div>
            <b className="w-8 text-right">{row.score}</b>
          </div>)}
        </div>
      </section>
    </div>

    <AutoAlerts history={history} hiveId={hiveId} />
  </div>
}

function ComponentCard({ item, live }) {
  const Icon = ICONS[item.key]
  return <div className={`rounded-2xl border p-4 ${STATUS_TONE[item.status]}`}>
    <div className="flex items-start justify-between gap-2">
      <div className="flex items-center gap-2 text-sm font-bold"><Icon size={17} />{item.label}</div>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${PILL[item.status]}`}>{LABEL[item.status]}</span>
    </div>
    <p className="mt-3 text-lg font-black leading-snug text-[#122c31]">{item.value}</p>
    <p className="mt-1 text-[11px] text-gray-500">Ideal: {item.ideal} · weight {item.weight}%</p>
    <p className="mt-2 text-xs leading-5">{item.advice}</p>
    <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{item.sensor} · {live ? 'Live' : 'Demo'}</p>
  </div>
}

function DemoBanner({ live }) {
  return <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
    <Info size={18} className="mt-0.5 shrink-0" />
    <p>{live.length
      ? 'Brood temperature, humidity and CO₂ are live from the ESP32. Sound, queen status, outside weather and the history are demo data until the microphone and the extra sensors are installed.'
      : 'Demo data: this hive has no live sensors connected, and the microphone (INMP441) and extra sensors are not installed yet. The values show how colony health will be tracked.'}</p>
  </div>
}

// How critical events reach the keeper: automatically, with no one pressing anything. Shows the latest ones.
function AutoAlerts({ history, hiveId }) {
  const alerts = useApi('/company/hive-alerts')
  const phone = alerts.data?.sms?.to ? `+91 ${alerts.data.sms.to}` : 'the keeper'
  const latest = history.filter((row) => row.notice === 'SENT').slice(-3).reverse()
  return <section className="rounded-2xl border border-[#c0dfdd] bg-white p-5">
    <h3 className="flex items-center gap-2 font-bold"><BellRing size={18} /> Automatic alerts</h3>
    <p className="mt-1 text-sm text-gray-500">When any component turns critical, the hive monitor alerts the keeper on its own: an SMS to the registered mobile and a notification in the app. Nobody has to press anything.</p>
    <ol className="mt-4 grid gap-3 md:grid-cols-4">
      {[['Sensors & microphone', 'read the hive every minute'], ['AI health check', 'finds a critical component'], ['Alert sent automatically', `SMS to ${phone} + app notification`], ['Log updated', 'the action is recorded in the Health Log']].map(([title, text], index) => <li key={title} className="rounded-xl bg-[#f4fbfb] p-3 text-xs"><span className="mb-1 grid h-6 w-6 place-items-center rounded-full bg-[#0F766E] text-[11px] font-black text-white">{index + 1}</span><b className="block text-sm">{title}</b><span className="text-gray-500">{text}</span></li>)}
    </ol>
    {latest.length > 0 && <div className="mt-4 space-y-2">
      <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Latest automatic alerts for {hiveId}</p>
      {latest.map((row) => <div key={row.time} className="flex flex-col justify-between gap-1 rounded-xl border border-red-100 bg-red-50/60 p-3 text-sm sm:flex-row sm:items-center">
        <span><b>{row.note}</b> <span className="text-xs text-gray-500">· {clock(row.time)}</span></span>
        <ActionTaken phone={phone} time={row.time} />
      </div>)}
    </div>}
  </section>
}

function ActionTaken({ phone, time }) {
  const at = new Date(new Date(time).getTime() + 60000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-teal-100 px-2 py-1 text-xs font-bold text-teal-800"><CheckCircle2 size={12} /> Auto-alert sent · SMS {phone} + app · {at}</span>
}

export function HealthLogTab({ hiveId }) {
  const history = useHistory(hiveId)
  const alerts = useApi('/company/hive-alerts')
  const [filter, setFilter] = useState('ALL')
  const phone = alerts.data?.sms?.to ? `+91 ${alerts.data.sms.to}` : 'the keeper'
  const sentAlerts = (alerts.data?.alerts || []).filter((alert) => alert.hiveCode === hiveId && alert.smsStatus !== 'COOLDOWN').slice(0, 8)
  const rows = [...history].reverse().filter((row) => filter === 'ALL' || row.status === filter)
  const chart = history.map((row) => ({ label: clock(row.time), score: row.score }))

  function downloadCsv() {
    const head = ['Time', 'Score', 'Status', 'Brood °C', 'Outside °C', 'Humidity %', 'CO2 ppm', 'Weight kg', 'Sound Hz', 'Queen', 'Event', 'Action taken (automatic)']
    const lines = [...history].reverse().map((row) => [row.time, row.score, row.status, row.brood, row.outside, row.humidity, row.co2, row.weight, row.soundHz, row.queen, row.note, notice(row.notice, phone)])
    const csv = [head, ...lines].map((line) => line.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    link.download = `${hiveId}-health-log.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return <div className="mt-6 space-y-6">
    <DemoBanner live={[]} />

    <section className="rounded-2xl border border-[#c0dfdd] bg-white p-5">
      <h2 className="text-lg font-black">Health history · {hiveId} · last 7 days</h2>
      <p className="mt-1 text-sm text-gray-500">A reading every 3 hours. Red marks the critical events; each one alerted the keeper automatically.</p>
      <div className="mt-4 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chart}>
            <CartesianGrid strokeDasharray="3 3" stroke="#dbeceb" />
            <ReferenceArea y1={0} y2={50} fill="#ef4444" fillOpacity={0.05} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={7} />
            <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
            <Tooltip />
            <Line type="monotone" dataKey="score" name="Colony score" stroke="#0F766E" strokeWidth={2} dot={(props) => props.payload.score < 50 ? <circle key={props.index} cx={props.cx} cy={props.cy} r={4} fill="#ef4444" /> : <g key={props.index} />} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>

    <section className="rounded-2xl border border-[#c0dfdd] bg-white p-5">
      <h3 className="flex items-center gap-2 font-bold"><MessageSquareText size={18} /> Alerts sent from this hive</h3>
      <p className="mt-1 text-xs text-gray-500">Real records: every alert the hive monitor sent to the keeper automatically.</p>
      {sentAlerts.length === 0
        ? <p className="mt-3 rounded-xl bg-gray-50 p-4 text-sm text-gray-500">No live alert yet. Alerts appear here as soon as the connected hive monitor finds a critical problem.</p>
        : <div className="mt-3 space-y-2">{sentAlerts.map((alert) => <div key={alert.id} className="flex flex-col justify-between gap-1 rounded-xl border border-red-100 bg-red-50/60 p-3 text-sm sm:flex-row sm:items-center">
            <span><b>{alert.riskName}</b> <span className="text-xs text-gray-500">· {clock(alert.createdAt)}</span></span>
            <span className="text-xs font-semibold text-teal-800">{alert.smsStatus === 'SENT' ? `SMS sent to ${alert.smsTo}` : alert.smsStatus === 'DRY_RUN' ? `SMS ready for ${alert.smsTo} (demo mode)` : alert.smsError || 'In-app alert only'} · in-app alert sent</span>
          </div>)}</div>}
    </section>

    <section className="rounded-2xl border border-[#c0dfdd] bg-white p-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-wrap gap-2">{['ALL', 'CRITICAL', 'WATCH', 'HEALTHY'].map((item) => <button key={item} onClick={() => setFilter(item)} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${filter === item ? 'bg-[#122c31] text-white' : 'bg-[#f4fbfb] text-gray-600'}`}>{item === 'ALL' ? 'All' : LABEL[item]}{item !== 'ALL' && ` (${history.filter((row) => row.status === item).length})`}</button>)}</div>
        <button onClick={downloadCsv} className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold"><Download size={16} /> Download CSV</button>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[1050px] text-left text-xs">
          <thead><tr className="border-b border-gray-100 text-gray-500">{['Time', 'Score', 'Status', 'Brood', 'Outside', 'Humidity', 'CO₂', 'Weight', 'Sound', 'Queen', 'Event', 'Action taken (automatic)'].map((heading) => <th key={heading} className="p-2.5">{heading}</th>)}</tr></thead>
          <tbody>{rows.map((row) => <tr key={row.time} className={`border-b border-gray-50 ${row.status === 'CRITICAL' ? 'bg-red-50/60' : ''}`}>
            <td className="whitespace-nowrap p-2.5">{clock(row.time)}</td>
            <td className="p-2.5 font-bold">{row.score}</td>
            <td className="p-2.5"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${PILL[row.status]}`}>{LABEL[row.status]}</span></td>
            <td className="p-2.5">{row.brood} °C</td>
            <td className="p-2.5">{row.outside} °C</td>
            <td className="p-2.5">{row.humidity} %</td>
            <td className="p-2.5">{row.co2}</td>
            <td className="whitespace-nowrap p-2.5">{row.weight} kg</td>
            <td className="p-2.5">{row.soundHz} Hz</td>
            <td className="p-2.5">{row.queen}</td>
            <td className="p-2.5">{row.note || '—'}</td>
            <td className="p-2.5"><NoticeCell kind={row.notice} phone={phone} time={row.time} /></td>
          </tr>)}</tbody>
        </table>
        {rows.length === 0 && <p className="p-8 text-center text-sm text-gray-400">No readings with this status.</p>}
      </div>
    </section>
  </div>
}

function notice(kind, phone) {
  if (kind === 'SENT') return `Auto-alert sent: SMS to ${phone} + app notification`
  if (kind === 'REPEAT') return 'Same problem within 6 h: not texted again'
  if (kind === 'APP') return 'Shown in the app'
  return ''
}

function NoticeCell({ kind, phone, time }) {
  if (kind === 'SENT') return <ActionTaken phone={phone} time={time} />
  if (kind === 'REPEAT') return <span className="inline-flex items-center gap-1.5 text-gray-500"><TriangleAlert size={12} /> Already notified (6 h rule)</span>
  if (kind === 'APP') return <span className="text-gray-500">Shown in the app</span>
  return <span className="text-gray-300">—</span>
}
