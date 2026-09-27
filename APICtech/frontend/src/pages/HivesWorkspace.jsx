import { useEffect, useState } from 'react'
import { ChevronRight, ClipboardList, HeartPulse, Hexagon, MapPin, Plus, Radio, Search, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import MainLayout from '../layouts/MainLayout'
import { apiRequest } from '../lib/api'
import { refreshSummary, useApi } from '../lib/store'
import { assess, demoHistory } from '../lib/colonyDemo'

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
    <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{filtered.map((hive) => <HiveCard key={hive.id} hive={hive} connected={connectedHiveId === hive.id} onOpen={(tab) => navigate(`/iot-monitoring/${hive.id}${tab ? `?tab=${tab}` : ''}`)} />)}</div>
    {filtered.length === 0 && <div className="mt-6 rounded-2xl border border-dashed border-[#a9cacd] p-10 text-center text-sm text-gray-500">No hives match your search.</div>}
    {showCreate && <CreateHiveModal form={form} setForm={setForm} onClose={() => setShowCreate(false)} onSubmit={createHive} />}
  </MainLayout>
}

const TONE = { HEALTHY: 'bg-teal-50 text-teal-700', WATCH: 'bg-orange-50 text-orange-700', CRITICAL: 'bg-red-50 text-red-700' }
const LABEL = { HEALTHY: 'Healthy', WATCH: 'Watch', CRITICAL: 'Critical' }

function HiveCard({ hive, connected, onOpen }) {
  const { score, status } = assess(demoHistory(hive.id).slice(-1)[0])
  return <article className={`flex flex-col rounded-2xl border bg-white p-5 shadow-sm ${connected ? 'border-teal-300' : 'border-[#c0dfdd]'}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#dbedeb] text-[#0F766E]"><Hexagon size={21} /></div>
        <div className="min-w-0">
          <h2 className="text-lg font-black leading-tight">{hive.id}</h2>
          <p className="truncate text-xs text-gray-500">{hive.name}</p>
        </div>
      </div>
      <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${connected ? 'bg-teal-100 text-teal-700' : 'bg-gray-100 text-gray-500'}`}>{connected ? 'Live' : 'Offline'}</span>
    </div>
    <p className="mt-2 flex items-center gap-1 text-xs text-gray-500"><MapPin size={13} />{hive.location}</p>
    <div className="mt-4 grid grid-cols-2 gap-3">
      <div className="rounded-xl bg-[#f4fbfb] p-3">
        <p className="text-[11px] text-gray-500">Colony health</p>
        <p className="mt-1 flex items-baseline gap-2"><b className="text-2xl font-black">{score}</b><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${TONE[status]}`}>{LABEL[status]}</span></p>
      </div>
      <div className="rounded-xl bg-[#f4fbfb] p-3">
        <p className="text-[11px] text-gray-500">Hive monitor</p>
        <p className={`mt-2 flex items-center gap-1.5 text-sm font-semibold ${connected ? 'text-teal-700' : 'text-gray-600'}`}><Radio size={14} />{connected ? 'ESP32 connected' : 'Not connected'}</p>
      </div>
    </div>
    <button onClick={() => onOpen()} className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#122c31] py-2.5 text-sm font-bold text-white hover:bg-[#1c3d44]">Open hive <ChevronRight size={16} /></button>
    <div className="mt-2 grid grid-cols-2 gap-2">
      <button onClick={() => onOpen('colony')} className="flex items-center justify-center gap-1.5 rounded-xl border border-[#c0dfdd] py-2 text-xs font-bold text-[#0F766E] hover:bg-[#f4fbfb]"><HeartPulse size={14} /> Colony health</button>
      <button onClick={() => onOpen('history')} className="flex items-center justify-center gap-1.5 rounded-xl border border-[#c0dfdd] py-2 text-xs font-bold text-[#0F766E] hover:bg-[#f4fbfb]"><ClipboardList size={14} /> Health log</button>
    </div>
  </article>
}

function CreateHiveModal({ form, setForm, onClose, onSubmit }) { return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><form onSubmit={onSubmit} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-gray-400">New hive</p><h2 className="mt-1 text-xl font-black">Create hive</h2></div><button type="button" onClick={onClose}><X size={19} /></button></div><div className="mt-6 space-y-4"><label className="block text-sm font-semibold">Hive name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="North apiary hive" className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5" /></label><label className="block text-sm font-semibold">Location<input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Leave blank to use your farm name" className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5" /></label></div><button type="submit" className="mt-6 w-full rounded-xl bg-[#F97360] py-3 text-sm font-bold">Create Hive</button></form></div> }
