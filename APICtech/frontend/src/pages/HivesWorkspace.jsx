import { useEffect, useState } from 'react'
import { Activity, BrainCircuit, HeartPulse, MapPin, Plus, Radio, Search, ShieldAlert, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import MainLayout from '../layouts/MainLayout'
import { apiRequest } from '../lib/api'
import { refreshSummary, useApi } from '../lib/store'

export default function HivesWorkspace() {
  const navigate = useNavigate()
  // Hives live in the company's private database.
  const hiveData = useApi('/company/hives')
  const hives = (hiveData.data || []).map((hive) => ({ id: hive.hive_code, name: hive.name, location: hive.location, status: hive.status }))
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', location: '' })
  const [connectedHiveId, setConnectedHiveId] = useState(() => localStorage.getItem('apictech_connected_hive'))

  useEffect(() => {
    const syncConnection = () => setConnectedHiveId(localStorage.getItem('apictech_connected_hive'))
    window.addEventListener('storage', syncConnection)
    return () => window.removeEventListener('storage', syncConnection)
  }, [])

  const filtered = hives.filter((hive) => `${hive.id} ${hive.name || ''} ${hive.location}`.toLowerCase().includes(search.toLowerCase()))

  async function createHive(event) {
    event.preventDefault()
    await apiRequest('/company/hives', { method: 'POST', body: JSON.stringify({ name: form.name, location: form.location }) })
    await Promise.all([hiveData.reload(), refreshSummary()])
    setForm({ name: '', location: '' })
    setShowCreate(false)
  }

  return <MainLayout title="My Hives">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><h1 className="text-2xl font-black">My Hives</h1><p className="mt-1 text-sm text-gray-500">Create, connect, and monitor every hive from one workspace.</p></div><button onClick={() => setShowCreate(true)} className="flex items-center justify-center gap-2 rounded-xl bg-[#F97360] px-4 py-3 text-sm font-bold"><Plus size={18} /> Add Hive</button></div>
    <div className="mt-6 rounded-2xl border border-[#c0dfdd] bg-white p-4"><div className="relative max-w-md"><Search size={18} className="absolute left-3 top-3 text-gray-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search hives..." className="w-full rounded-xl border border-gray-200 py-2.5 pl-10 pr-4 outline-none focus:border-[#F97360]" /></div></div>
    <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{filtered.map((hive) => { const connected = connectedHiveId === hive.id; return <article key={hive.id} className={`rounded-2xl border bg-white p-6 shadow-sm ${connected ? 'border-teal-300' : 'border-[#c0dfdd]'}`}><div className="flex items-start justify-between"><div className="flex items-center gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#dbedeb] text-2xl">🐝</div><div><h2 className="text-lg font-bold">{hive.id}</h2><p className="text-xs text-gray-500">{hive.name}</p><div className="mt-1 flex items-center gap-1 text-xs text-gray-500"><MapPin size={13} />{hive.location}</div></div></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${connected ? 'bg-teal-100 text-teal-700' : 'bg-gray-100 text-gray-500'}`}>{connected ? 'Active' : 'Offline'}</span></div><div className="mt-6 grid grid-cols-2 gap-3"><div className="rounded-xl bg-[#f4fbfb] p-4"><p className="text-xs text-gray-500">IoT Monitoring</p><div className={`mt-2 flex items-center gap-2 text-sm font-semibold ${connected ? 'text-teal-700' : 'text-gray-600'}`}><Radio size={15} />{connected ? 'ESP32 Connected' : 'Offline'}</div></div><div className="rounded-xl bg-[#f4fbfb] p-4"><p className="text-xs text-gray-500">Hive Health</p><div className="mt-2 flex items-center gap-2 text-sm font-semibold"><HeartPulse size={15} />{connected ? 'Monitoring live' : 'Awaiting device'}</div></div></div><div className={`mt-4 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold ${connected ? 'bg-teal-50 text-teal-700' : 'bg-gray-50 text-gray-500'}`}><Activity size={15} />{connected ? 'This is the active connected hive' : 'Connect an ESP32 from View Hive to activate'}</div><div className="mt-4 rounded-xl border border-[#c0dfdd] bg-white p-4"><div className="flex items-start gap-3"><div className="rounded-lg bg-[#dbedeb] p-2"><BrainCircuit size={18} /></div><div><p className="font-bold">AI Health Analysis</p><p className="mt-1 text-xs leading-5 text-gray-500">{connected ? 'Analyzing IoT readings, hive history, thermal images, and production patterns.' : 'Connect an IoT device to enable AI-powered hive health analysis.'}</p></div></div><div className="mt-3 flex items-start gap-2 rounded-lg bg-gray-50 p-3"><ShieldAlert size={15} className="mt-0.5 shrink-0 text-gray-400" /><p className="text-xs text-gray-500">{connected ? 'Disease-risk analysis will appear as sufficient hive data is collected.' : 'Disease-risk analysis is unavailable until sufficient hive data is available.'}</p></div></div><button onClick={() => navigate(`/iot-monitoring/${hive.id}`)} className="mt-5 w-full rounded-xl border border-[#f97763] py-3 text-sm font-bold hover:bg-[#f4fbfb]">View Hive Monitoring</button></article> })}</div>
    {filtered.length === 0 && <div className="mt-6 rounded-2xl border border-dashed border-[#a9cacd] p-10 text-center text-sm text-gray-500">No hives match your search.</div>}
    {showCreate && <CreateHiveModal form={form} setForm={setForm} onClose={() => setShowCreate(false)} onSubmit={createHive} />}
  </MainLayout>
}

function CreateHiveModal({ form, setForm, onClose, onSubmit }) { return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><form onSubmit={onSubmit} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-gray-400">New hive</p><h2 className="mt-1 text-xl font-black">Create hive</h2></div><button type="button" onClick={onClose}><X size={19} /></button></div><div className="mt-6 space-y-4"><label className="block text-sm font-semibold">Hive name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="North apiary hive" className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5" /></label><label className="block text-sm font-semibold">Location<input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Leave blank to use your farm name" className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5" /></label></div><button type="submit" className="mt-6 w-full rounded-xl bg-[#F97360] py-3 text-sm font-bold">Create Hive</button></form></div> }
