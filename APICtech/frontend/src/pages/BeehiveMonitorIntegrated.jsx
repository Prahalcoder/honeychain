import { useEffect, useState } from 'react'
import {
  Activity, ArrowLeft, Camera, CheckCircle2, Download, Fan, FileJson,
  Flame, Gauge, Image as ImageIcon, LineChart as LineChartIcon,
  MonitorCog, PauseCircle, PlayCircle, RefreshCw, Save, Search,
  Settings2, SlidersHorizontal, Sparkles, Thermometer, Wifi, WifiOff, Wind, X,
} from 'lucide-react'
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useNavigate, useParams } from 'react-router-dom'
import MainLayout from '../layouts/MainLayout'
import { BEEHIVE_API_URL } from '../lib/api'
import HiveSmsAlerts, { linkMonitorToHive } from '../components/HiveSmsAlerts'

const tabs = [
  ['dashboard', 'Live Dashboard & Trends', Gauge],
  ['logs', 'Daily Data Logs', FileJson],
  ['config', 'Config', Settings2],
]
const ranges = [5, 10, 30, 50, 'today']

export default function BeehiveMonitorIntegrated() {
  const navigate = useNavigate()
  const { hiveId = 'H001' } = useParams()
  const [tab, setTab] = useState('dashboard')
  const [live, setLive] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [polling, setPolling] = useState(true)
  const [range, setRange] = useState(30)
  const [trends, setTrends] = useState([])
  const [camera, setCamera] = useState({ devices: [], active: false, resolution: '' })
  const [cameraDevice, setCameraDevice] = useState(0)
  const [logs, setLogs] = useState([])
  const [dates, setDates] = useState([])
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [summary, setSummary] = useState(null)
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState('')
  const [snapshot, setSnapshot] = useState(false)
  const [insights, setInsights] = useState(null)
  const [config, setConfig] = useState({ ip: '', ctrl_source: 0, bulb_on: '', bulb_off: '', fan_on: '', fan_off: '', ssid: '', password: '' })
  const telemetry = live?.telemetry || {}
  const connectedHiveId = localStorage.getItem('apictech_connected_hive')
  const hiveConnected = connectedHiveId === hiveId && Boolean(live?.connected)

  async function api(path, options = {}) {
    const response = await fetch(`${BEEHIVE_API_URL}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options,
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.message || 'Request failed')
    return result
  }

  async function refreshLive() {
    try {
      const result = await api('/live')
      setLive(result)
      setPolling(result.polling_active !== false)
      setError('')
      setConfig((current) => ({
        ...current, ip: result.target_ip || current.ip,
        ctrl_source: result.telemetry?.ctrl_source ?? current.ctrl_source,
        bulb_on: result.telemetry?.bulb_on_temp ?? current.bulb_on,
        bulb_off: result.telemetry?.bulb_off_temp ?? current.bulb_off,
        fan_on: result.telemetry?.fan_on_temp ?? current.fan_on,
        fan_off: result.telemetry?.fan_off_temp ?? current.fan_off,
      }))
    } catch (err) {
      setError('Unable to connect to Beehive Monitor')
      setLive(null)
    } finally { setLoading(false) }
  }

  async function refreshInsights() {
    try { setInsights(await api('/insights')) } catch { setInsights(null) }
  }

  async function refreshTrends() {
    try {
      const result = await api(`/logs/recent?limit=${range === 'today' ? 200 : range}`)
      setTrends((result.readings || []).map((item) => ({
        ...item, label: item.time || item.timestamp || '',
        average: item.avg_temp, gas: item.co2_ppm ?? item.gas_ppm ?? item.gas_val,
      })))
    } catch { setTrends([]) }
  }

  async function refreshCamera() {
    try {
      const result = await api('/camera/devices')
      setCamera({ devices: result.devices || [], active: Boolean(result.active), resolution: result.resolution || '' })
      setCameraDevice(result.current_device ?? 0)
    } catch { setCamera({ devices: [], active: false, resolution: '' }) }
  }

  async function refreshLogs() {
    try {
      const result = await api(`/logs?date=${date}`)
      setLogs(result.records || [])
      setSummary(result.summary || null)
    } catch { setLogs([]); setSummary(null) }
  }

  async function refreshDates() {
    try { setDates((await api('/logs/dates')).dates || []) } catch { setDates([]) }
  }

  useEffect(() => {
    refreshLive(); refreshCamera(); refreshInsights()
    const interval = setInterval(refreshLive, 2500)
    const insightTimer = setInterval(refreshInsights, 15000)
    return () => { clearInterval(interval); clearInterval(insightTimer) }
  }, [])

  useEffect(() => {
    if (tab === 'dashboard') refreshTrends()
    if (tab === 'logs') { refreshLogs(); refreshDates() }
  }, [tab, range, date])

  async function toggleConnection() {
    try {
      const result = await api('/esp32/connection', { method: 'POST', body: JSON.stringify({ action: polling && hiveConnected ? 'disconnect' : 'connect' }) })
      setPolling(result.polling_active)
      if (result.polling_active) {
        localStorage.setItem('apictech_connected_hive', hiveId)
        // The hive now being monitored is the one its SMS alerts are about.
        linkMonitorToHive(hiveId).catch(() => { /* the SMS alerts card offers the link again */ })
      } else if (localStorage.getItem('apictech_connected_hive') === hiveId) {
        localStorage.removeItem('apictech_connected_hive')
      }
      refreshLive()
    } catch (err) { setError(err.message) }
  }

  async function toggleCamera() {
    try {
      const result = await api('/camera/toggle', { method: 'POST', body: JSON.stringify({ action: camera.active ? 'stop' : 'start', device_id: cameraDevice }) })
      setCamera((current) => ({ ...current, active: result.active, resolution: result.resolution || '' }))
    } catch (err) { setNotice(err.message) }
  }

  async function selectCamera(event) {
    const deviceId = Number(event.target.value)
    setCameraDevice(deviceId)
    try {
      const result = await api('/camera/select', { method: 'POST', body: JSON.stringify({ device_id: deviceId }) })
      setCamera((current) => ({ ...current, active: result.active, resolution: result.resolution || '' }))
    } catch (err) { setNotice(err.message) }
  }

  async function saveClimate(event) {
    event.preventDefault()
    try {
      await api('/esp32/ip', { method: 'POST', body: JSON.stringify({ ip: config.ip }) })
      await api('/esp32/thresholds', { method: 'POST', body: JSON.stringify({
        bulb_on: Number(config.bulb_on), bulb_off: Number(config.bulb_off),
        fan_on: Number(config.fan_on), fan_off: Number(config.fan_off), ctrl_source: Number(config.ctrl_source),
      }) })
      setNotice('ESP32 climate settings saved.')
    } catch (err) { setNotice(err.message) }
  }

  async function saveWifi(event) {
    event.preventDefault()
    try {
      await api('/esp32/wifi', { method: 'POST', body: JSON.stringify({ ssid: config.ssid, password: config.password }) })
      setNotice('Wi-Fi credentials sent to the ESP32.')
    } catch (err) { setNotice(err.message) }
  }

  const filteredLogs = logs.filter((item) => JSON.stringify(item).toLowerCase().includes(search.toLowerCase()))

  return <MainLayout title={`${hiveId} Beehive Monitor`}>
    <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
      <div className="flex items-start gap-3"><button onClick={() => navigate('/hives')} className="rounded-xl border border-[#c0dfdd] bg-white p-2.5" title="Back to My Hives"><ArrowLeft size={19} /></button><div><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-black">{hiveId} Beehive Monitor</h1><span className="rounded-full bg-[#dbedeb] px-3 py-1 text-xs font-bold">ESP32 Station</span></div><p className="mt-1 text-sm text-gray-500">Full environmental monitoring and climate control for this hive.</p></div></div>
      <div className="flex flex-wrap items-center gap-3"><div className="flex items-center gap-2 rounded-xl border border-[#c0dfdd] bg-white px-3 py-2 text-sm"><span className={`h-2.5 w-2.5 rounded-full ${hiveConnected ? 'bg-teal-500' : 'bg-red-500'}`} /><b>{hiveConnected ? 'Connected' : 'Offline'}</b><span className="text-xs text-gray-400">{live?.target_ip || 'ESP32'}</span></div><button onClick={toggleConnection} className="flex items-center gap-2 rounded-xl bg-[#F97360] px-4 py-2.5 text-sm font-bold">{polling && hiveConnected ? <PauseCircle size={17} /> : <PlayCircle size={17} />}{polling && hiveConnected ? 'Disconnect' : 'Connect ESP32'}</button></div>
    </div>
    <div className="mt-6 flex flex-wrap gap-2 border-b border-[#c0dfdd] pb-3">{tabs.map(([id, label, Icon]) => <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold ${tab === id ? 'bg-[#122c31] text-white' : 'bg-white text-gray-600'}`}><Icon size={17} />{label}</button>)}</div>
    {error && <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}. The monitor will keep retrying while the device is offline.</div>}
    {notice && <div className="mt-5 flex items-center justify-between rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-700"><span className="flex items-center gap-2"><CheckCircle2 size={17} />{notice}</span><button onClick={() => setNotice('')}><X size={16} /></button></div>}
    {!hiveConnected && !loading && <div className="mt-5 rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800">This hive is offline. Connect an ESP32 here to make {hiveId} the active hive. Other hive pages remain offline.</div>}
    {tab === 'dashboard' && <HiveHealthCard insights={insights} hiveId={hiveId} />}
    {tab === 'dashboard' && <HiveSmsAlerts hiveId={hiveId} />}
    {tab === 'dashboard' && <Dashboard telemetry={hiveConnected ? telemetry : {}} loading={loading} trends={trends} range={range} setRange={setRange} camera={camera} cameraDevice={cameraDevice} onCameraChange={selectCamera} onCameraToggle={toggleCamera} onSnapshot={() => setSnapshot(true)} />}
    {tab === 'logs' && <Logs logs={filteredLogs} summary={summary} dates={dates} date={date} setDate={setDate} search={search} setSearch={setSearch} refresh={refreshLogs} />}
    {tab === 'config' && <Config config={config} setConfig={setConfig} saveClimate={saveClimate} saveWifi={saveWifi} sync={refreshLive} />}
    {snapshot && <Snapshot onClose={() => setSnapshot(false)} />}
  </MainLayout>
}

function Dashboard({ telemetry, loading, trends, range, setRange, camera, cameraDevice, onCameraChange, onCameraToggle, onSnapshot }) {
  return <div className="mt-6 space-y-6"><Heading icon={MonitorCog} title="Hardware Probes & Climate Actuators" /><div className="grid gap-5 xl:grid-cols-2"><div className="space-y-5"><Probe number="1" pin="32" temp={telemetry.temp1} humidity={telemetry.hum1} /><Probe number="2" pin="33" temp={telemetry.temp2} humidity={telemetry.hum2} /></div><div className="space-y-5"><Actuator icon={Flame} label="Warmer" status={telemetry.bulb_status} pin="14" on={telemetry.bulb_on_temp} off={telemetry.bulb_off_temp} /><Actuator icon={Fan} label="Cooler" status={telemetry.fan_status} pin="23" on={telemetry.fan_on_temp} off={telemetry.fan_off_temp} /></div></div><Heading icon={Activity} title="Environmental Analysis & Live Camera" /><div className="grid gap-5 xl:grid-cols-3"><div className="grid gap-5 sm:grid-cols-2 xl:col-span-2"><Metric label="Average Temperature" value={telemetry.avg_temp} unit="°C" detail="Ideal range: 28-35°C" icon={Thermometer} /><Metric label="Average Humidity" value={telemetry.avg_hum} unit="%" detail="From both DHT11 probes" icon={Wind} /><Metric label="Carbon Dioxide / Gas" value={telemetry.co2_ppm ?? telemetry.gas_val} unit={telemetry.co2_ppm !== undefined ? 'ppm' : 'ADC'} detail={quality(telemetry.co2_ppm ?? telemetry.gas_val)} icon={Wind} /><Metric label="Control Source" value={telemetry.ctrl_source_name || source(telemetry.ctrl_source)} detail={`Control temperature: ${show(telemetry.control_temp)}°C`} icon={Gauge} /></div><CameraCard camera={camera} device={cameraDevice} onChange={onCameraChange} onToggle={onCameraToggle} onSnapshot={onSnapshot} /></div><section className="rounded-2xl border border-[#c0dfdd] bg-white p-5"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><Heading icon={LineChartIcon} title="Environmental Trends" compact /><div className="flex flex-wrap gap-2">{ranges.map((item) => <button key={item} onClick={() => setRange(item)} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${range === item ? 'bg-[#F97360]' : 'bg-[#f4fbfb] text-gray-500'}`}>{item === 'today' ? 'Today' : `${item} pts`}</button>)}</div></div>{loading ? <Loading /> : <div className="mt-5 grid gap-8 lg:grid-cols-3"><Chart data={trends} keyName="average" color="#0F766E" title="Temperature" /><Chart data={trends} keyName="avg_hum" color="#0891b2" title="Humidity" /><Chart data={trends} keyName="gas" color="#05968c" title="Gas / CO2" /></div>}</section></div>
}

const HEALTH_TONES = { HEALTHY: 'bg-teal-100 text-teal-800', WATCH: 'bg-orange-100 text-orange-800', AT_RISK: 'bg-red-100 text-red-800', NO_DATA: 'bg-gray-100 text-gray-600' }
const RISK_TONES = { HIGH: 'bg-red-50 text-red-700', MEDIUM: 'bg-orange-50 text-orange-700', LOW: 'bg-blue-50 text-blue-700' }

// AI hive health: risk indicators from recent sensor data, for the keeper to act on.
function HiveHealthCard({ insights, hiveId }) {
  if (!insights) return <section className="mt-6 rounded-2xl border border-[#c0dfdd] bg-white p-5 text-sm text-gray-500">AI hive health is unavailable until the monitoring service responds.</section>
  const metrics = insights.metrics || {}

  return <section className="mt-6 rounded-2xl border border-[#c0dfdd] bg-white p-5">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
      <div><h2 className="flex items-center gap-2 text-lg font-black"><Sparkles size={19} /> AI Hive Health · {hiveId}</h2><p className="mt-1 text-sm text-gray-500">{insights.message || `Colony analysis from ${insights.data_points} recent sensor readings.`}</p></div>
      <div className="flex items-center gap-3">{insights.score !== null && <div className="text-right"><p className="text-3xl font-black leading-none">{insights.score}</p><p className="text-[11px] text-gray-400">health score</p></div>}<span className={`rounded-full px-3 py-1.5 text-xs font-bold ${HEALTH_TONES[insights.status]}`}>{String(insights.status).replace('_', ' ')}</span></div>
    </div>
    {insights.metrics && <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Mini label="Time in ideal temperature" value={metrics.time_in_ideal_temp_pct ?? '--'} unit="%" icon={Thermometer} />
      <Mini label="Average humidity" value={metrics.avg_humidity ?? '--'} unit="%" icon={Wind} />
      <Mini label="Temperature trend" value={metrics.temp_trend_c_per_hour ?? '--'} unit="°C/h" icon={Activity} />
      <Mini label="Hive weight" value={metrics.hive_weight_kg ?? '--'} unit={metrics.hive_weight_kg != null ? 'kg' : ''} icon={Gauge} />
    </div>}
    <p className="mt-3 text-xs text-gray-500">Productivity: {insights.productivity}</p>
    {insights.risks.length > 0 ? <div className="mt-4 grid gap-3 lg:grid-cols-2">{insights.risks.map((risk) => <div key={risk.name} className={`rounded-xl p-4 ${RISK_TONES[risk.level]}`}><p className="text-sm font-bold">{risk.name} <span className="ml-1 text-[10px] opacity-70">{risk.level}</span></p><p className="mt-1 text-xs leading-5">{risk.reason}</p><p className="mt-1 text-xs font-semibold">→ {risk.action}</p></div>)}</div> : <p className="mt-4 rounded-xl bg-teal-50 p-4 text-sm text-teal-800">No abnormal conditions detected in the recent readings.</p>}
    <p className="mt-3 text-[11px] text-gray-400">{insights.disclaimer} Engine: {insights.engine}.</p>
  </section>
}

function Probe({ number, pin, temp, humidity }) { return <section className="rounded-2xl border border-[#c0dfdd] bg-white p-5"><div className="flex items-center justify-between"><h3 className="font-bold">DHT11 Probe #{number}</h3><span className="rounded-full bg-[#dbedeb] px-3 py-1 text-xs font-bold">GPIO {pin}</span></div><div className="mt-5 grid grid-cols-2 gap-3"><Mini label={`Temperature ${number}`} value={temp} unit="°C" icon={Thermometer} /><Mini label={`Humidity ${number}`} value={humidity} unit="%" icon={Wind} /></div></section> }
function Actuator({ icon: Icon, label, status, pin, on, off }) { const active = String(status || '').toLowerCase() === 'on' || status === true; return <section className="rounded-2xl border border-[#c0dfdd] bg-white p-5"><div className="flex items-center gap-3"><div className={`rounded-xl p-3 ${active ? 'bg-teal-100 text-teal-700' : 'bg-gray-100 text-gray-500'}`}><Icon size={22} /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">{label}</h3><span className={`rounded-full px-3 py-1 text-xs font-bold ${active ? 'bg-teal-100 text-teal-700' : 'bg-gray-100 text-gray-500'}`}>{active ? 'ON' : 'OFF'}</span></div><p className="mt-1 text-xs text-gray-500">Relay GPIO {pin} | Automatic temperature control</p></div></div><div className="mt-4 grid grid-cols-2 gap-3 text-xs"><div className="rounded-lg bg-[#f4fbfb] p-3">Turns on at <b>{show(on)}°C</b></div><div className="rounded-lg bg-[#f4fbfb] p-3">Turns off at <b>{show(off)}°C</b></div></div></section> }
function CameraCard({ camera, device, onChange, onToggle, onSnapshot }) { return <section className="rounded-2xl border border-[#c0dfdd] bg-white p-5"><div className="flex items-center justify-between"><h3 className="flex items-center gap-2 font-bold"><Camera size={18} /> OpenCV Camera</h3>{camera.active && <span className="rounded-full bg-teal-100 px-2 py-1 text-xs font-bold text-teal-700">LIVE</span>}</div><div className="mt-4 flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-gray-950">{camera.active ? <img src={`${BEEHIVE_API_URL}/camera/stream`} alt="Live hive camera" className="h-full w-full object-cover" /> : <div className="text-center text-gray-500"><ImageIcon className="mx-auto" size={30} /><p className="mt-2 text-xs">Camera preview disabled</p></div>}</div><div className="mt-4 space-y-3"><select value={device} onChange={onChange} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"><option value="0">Default camera</option>{camera.devices.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.resolution})</option>)}</select><div className="flex gap-2"><button onClick={onToggle} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#F97360] px-3 py-2.5 text-sm font-bold">{camera.active ? <WifiOff size={16} /> : <Camera size={16} />}{camera.active ? 'Stop Preview' : 'Enable Preview'}</button><button onClick={onSnapshot} disabled={!camera.active} className="rounded-xl border border-gray-200 p-2.5" title="Snapshot"><Download size={17} /></button></div><p className="text-xs text-gray-400">{camera.resolution || 'No camera active'}</p></div></section> }
function Chart({ data, keyName, color, title }) { return <div><h4 className="mb-3 text-sm font-bold">{title}</h4><div className="h-52"><ResponsiveContainer width="100%" height="100%"><LineChart data={data}><CartesianGrid strokeDasharray="3 3" stroke="#dbeceb" /><XAxis dataKey="label" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip /><Line type="monotone" dataKey={keyName} stroke={color} strokeWidth={2} dot={false} connectNulls /></LineChart></ResponsiveContainer></div></div> }

function Logs({ logs, summary, dates, date, setDate, search, setSearch, refresh }) { return <div className="mt-6 space-y-5"><div className="flex flex-col justify-between gap-3 rounded-2xl border border-[#c0dfdd] bg-white p-5 lg:flex-row lg:items-center"><div className="flex flex-wrap gap-2"><input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="rounded-xl border border-gray-200 px-3 py-2 text-sm" /><select value={date} onChange={(event) => setDate(event.target.value)} className="rounded-xl border border-gray-200 px-3 py-2 text-sm"><option value={date}>Stored dates</option>{dates.map((item) => <option key={item.date_iso || item} value={item.date_iso || item}>{item.formatted_date || item.date_iso || item}</option>)}</select></div><div className="flex gap-2"><button onClick={refresh} className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold"><RefreshCw size={16} /> Refresh</button><a href={`${BEEHIVE_API_URL}/logs/download?date=${date}`} className="flex items-center gap-2 rounded-xl bg-[#F97360] px-3 py-2 text-sm font-bold"><Download size={16} /> Export JSON</a></div></div><div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">{[['Min temp', summary?.min_temp, '°C'], ['Max temp', summary?.max_temp, '°C'], ['Avg temp', summary?.avg_temp, '°C'], ['Avg humidity', summary?.avg_hum, '%'], ['Avg gas', summary?.avg_gas, ''], ['Records', summary?.count ?? logs.length, '']].map(([label, value, unit]) => <Metric key={label} label={label} value={value} unit={unit} compact />)}</div><section className="rounded-2xl border border-[#c0dfdd] bg-white p-5"><div className="relative mb-4 max-w-sm"><Search size={16} className="absolute left-3 top-3 text-gray-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search readings..." className="w-full rounded-xl border border-gray-200 py-2 pl-9 pr-3 text-sm" /></div><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-xs"><thead><tr className="border-b border-gray-100 text-gray-500">{['Timestamp', 'Temp 1', 'Temp 2', 'Avg temp', 'Avg humidity', 'Gas', 'Warmer', 'Cooler'].map((heading) => <th key={heading} className="p-3">{heading}</th>)}</tr></thead><tbody>{logs.map((item, index) => <tr key={item.timestamp || index} className="border-b border-gray-50"><td className="p-3">{item.timestamp || item.time || '--'}</td><td className="p-3">{show(item.temp1)}°C</td><td className="p-3">{show(item.temp2)}°C</td><td className="p-3">{show(item.avg_temp)}°C</td><td className="p-3">{show(item.avg_hum)}%</td><td className="p-3">{show(item.gas_val)}</td><td className="p-3">{show(item.bulb_status)}</td><td className="p-3">{show(item.fan_status)}</td></tr>)}</tbody></table>{logs.length === 0 && <p className="p-8 text-center text-sm text-gray-400">No readings found for this date.</p>}</div></section></div> }

function Config({ config, setConfig, saveClimate, saveWifi, sync }) { const update = (field, value) => setConfig((current) => ({ ...current, [field]: value })); return <div className="mt-6 grid gap-5 xl:grid-cols-2"><form onSubmit={saveClimate} className="rounded-2xl border border-[#c0dfdd] bg-white p-5"><Heading icon={SlidersHorizontal} title="ESP32 Climate Control" compact /><div className="mt-5 space-y-4"><Field label="ESP32 target IP"><input value={config.ip} onChange={(event) => update('ip', event.target.value)} placeholder="192.168.1.100" className="field" /></Field><Field label="Control source"><select value={config.ctrl_source} onChange={(event) => update('ctrl_source', event.target.value)} className="field"><option value="0">Average of DHT11 probes</option><option value="1">DHT11 probe 1 only</option><option value="2">DHT11 probe 2 only</option></select></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Warmer ON"><input type="number" step="0.1" value={config.bulb_on} onChange={(event) => update('bulb_on', event.target.value)} className="field" /></Field><Field label="Warmer OFF"><input type="number" step="0.1" value={config.bulb_off} onChange={(event) => update('bulb_off', event.target.value)} className="field" /></Field><Field label="Cooler ON"><input type="number" step="0.1" value={config.fan_on} onChange={(event) => update('fan_on', event.target.value)} className="field" /></Field><Field label="Cooler OFF"><input type="number" step="0.1" value={config.fan_off} onChange={(event) => update('fan_off', event.target.value)} className="field" /></Field></div><div className="flex flex-wrap gap-2"><button type="submit" className="flex items-center gap-2 rounded-xl bg-[#F97360] px-4 py-2.5 text-sm font-bold"><Save size={16} /> Save to ESP32</button><button type="button" onClick={sync} className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold"><RefreshCw size={16} /> Sync active values</button></div></div></form><form onSubmit={saveWifi} className="rounded-2xl border border-[#c0dfdd] bg-white p-5"><Heading icon={Wifi} title="Wi-Fi Credentials" compact /><p className="mt-2 text-sm text-gray-500">Send network credentials to the ESP32 station.</p><div className="mt-5 space-y-4"><Field label="Wi-Fi SSID"><input value={config.ssid} onChange={(event) => update('ssid', event.target.value)} className="field" /></Field><Field label="Wi-Fi password"><input type="password" value={config.password} onChange={(event) => update('password', event.target.value)} className="field" /></Field><button type="submit" className="flex items-center gap-2 rounded-xl bg-[#F97360] px-4 py-2.5 text-sm font-bold"><Save size={16} /> Save Wi-Fi settings</button></div></form></div> }

function Field({ label, children }) { return <label className="block text-sm font-semibold">{label}<span className="mt-1 block">{children}</span></label> }
function Heading({ icon: Icon, title, compact }) { return <div className="flex items-center gap-2"><Icon size={compact ? 17 : 20} /><h2 className={compact ? 'text-base font-bold' : 'text-lg font-black'}>{title}</h2></div> }
function Mini({ icon: Icon, label, value, unit }) { return <div className="rounded-xl bg-[#f4fbfb] p-4"><div className="flex items-center gap-2 text-xs text-gray-500"><Icon size={15} />{label}</div><p className="mt-2 text-2xl font-black">{show(value)} <span className="text-sm font-semibold text-gray-400">{unit}</span></p></div> }
function Metric({ icon: Icon = Activity, label, value, unit, detail, compact }) { return <div className={`rounded-2xl border border-[#c0dfdd] bg-white ${compact ? 'p-3' : 'p-5'}`}><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-gray-500">{label}</p>{!compact && <Icon size={18} className="text-[#0F766E]" />}</div><p className={`${compact ? 'mt-2 text-lg' : 'mt-4 text-3xl'} font-black`}>{show(value)}{value !== undefined && value !== null && value !== '' && unit && <span className="ml-1 text-sm font-semibold text-gray-400">{unit}</span>}</p>{detail && <p className="mt-1 text-xs text-gray-400">{detail}</p>}</div> }
function ChartLoading() { return <div className="flex items-center justify-center gap-2 p-12 text-sm text-gray-500"><RefreshCw size={18} className="animate-spin" /> Loading monitor data...</div> }
function Loading() { return <ChartLoading /> }
function Snapshot({ onClose }) { const url = `${BEEHIVE_API_URL}/camera/snapshot?t=${Date.now()}`; return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><div className="w-full max-w-3xl rounded-2xl bg-white p-5"><div className="flex items-center justify-between"><h2 className="font-bold">Hive Camera Snapshot</h2><button onClick={onClose}><X size={19} /></button></div><img src={url} alt="Hive camera snapshot" className="mt-4 max-h-[70vh] w-full rounded-xl object-contain" /><a href={url} download="h001-hive-snapshot.jpg" className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-[#F97360] py-3 text-sm font-bold"><Download size={17} /> Download snapshot</a></div></div> }
function show(value) { return value === undefined || value === null || value === '' ? '--' : value }
function source(value) { return Number(value) === 1 ? 'DHT11 probe 1' : Number(value) === 2 ? 'DHT11 probe 2' : 'Average of probes' }
function quality(value) { if (value === undefined || value === null) return 'Waiting for gas sensor'; return Number(value) < 800 ? 'Good air quality' : Number(value) < 1400 ? 'Watch air quality' : 'High gas reading' }
