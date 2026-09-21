import { useEffect, useState } from 'react'
import { Megaphone, Pin } from 'lucide-react'

import { apiRequest } from '../lib/api'

const TONE = {
  URGENT: 'border-rose-200 bg-rose-50',
  IMPORTANT: 'border-orange-200 bg-orange-50',
  NORMAL: 'border-sky-100 bg-sky-50/60',
}
const TAG = { URGENT: 'bg-rose-600 text-white', IMPORTANT: 'bg-orange-500 text-white', NORMAL: 'bg-sky-100 text-sky-700' }

const when = (value) => new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

// Important notices from the regional, state and national KVIC offices.
export default function NoticeBoard({ className = '' }) {
  const [notices, setNotices] = useState(null)

  useEffect(() => {
    let alive = true
    const load = () => apiRequest('/company/announcements').then((data) => { if (alive) setNotices(data) }).catch(() => { if (alive) setNotices([]) })
    load()
    const timer = window.setInterval(load, 30000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [])

  return (
    <section className={`flex flex-col overflow-hidden rounded-3xl border border-[#c0dedc] bg-white shadow-[0_16px_40px_rgba(36,84,94,0.12)] ${className}`}>
      <div className="flex items-center gap-3 bg-gradient-to-r from-[#F97360] to-[#F97360] px-5 py-4">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/80 text-[#178c88]"><Megaphone size={20} /></span>
        <div>
          <h2 className="text-lg font-black leading-tight text-[#10262a]">Notice board</h2>
          <p className="text-xs font-semibold text-[#193c43]">From your KVIC offices</p>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4" style={{ maxHeight: 360 }}>
        {notices === null && <p className="text-sm text-gray-400">Loading notices…</p>}
        {notices && notices.length === 0 && (
          <div className="grid h-full place-items-center p-6 text-center text-sm text-gray-500">
            <div><Pin className="mx-auto mb-2 text-gray-300" size={28} />No notices right now. Announcements from your regional, state and national office will be pinned here.</div>
          </div>
        )}
        {notices?.map((notice) => (
          <article key={notice.id} className={`rounded-2xl border p-3.5 ${TONE[notice.priority]}`}>
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${TAG[notice.priority]}`}>{notice.priority === 'NORMAL' ? 'Notice' : notice.priority}</span>
              <span className="text-[11px] font-semibold text-gray-500">{notice.from} · {when(notice.createdAt)}</span>
            </div>
            <h3 className="mt-1.5 font-black leading-snug text-[#122c31]">{notice.title}</h3>
            <p className="mt-1 whitespace-pre-line text-sm text-gray-700">{notice.body}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
