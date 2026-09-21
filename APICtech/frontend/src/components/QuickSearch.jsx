import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'

// Jump to any page: click the search box or press Ctrl/Cmd + K.
export default function QuickSearch({ sections }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const input = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setOpen(true) }
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) { setQuery(''); window.setTimeout(() => input.current?.focus(), 30) }
  }, [open])

  const pages = sections.flatMap((section) => section.items.map((item) => ({ ...item, section: section.title })))
  const matches = pages.filter((page) => `${page.name} ${page.section}`.toLowerCase().includes(query.trim().toLowerCase()))

  function go(path) {
    setOpen(false)
    navigate(path)
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="hidden items-center gap-2 rounded-xl border border-[#c0dedc] bg-white px-3 py-2 text-xs font-semibold text-[#43696c] shadow-sm transition hover:border-[#f76049] sm:flex">
        <Search size={15} />
        <span>Search workspace</span>
        <kbd className="rounded-md bg-[#d7eae9] px-1.5 py-0.5 text-[10px]">Ctrl K</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 p-4 pt-[12vh] backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-gray-100 px-4">
              <Search size={18} className="text-gray-400" />
              <input
                ref={input}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter' && matches[0]) go(matches[0].path) }}
                placeholder="Go to a page…"
                className="w-full bg-transparent py-4 text-base outline-none"
              />
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
              {matches.length === 0 && <p className="p-4 text-sm text-gray-500">No page matches this search.</p>}
              {matches.map((page) => {
                const Icon = page.icon
                return (
                  <button key={page.path} onClick={() => go(page.path)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-[#e4f1f0]">
                    <Icon size={18} className="text-[#0F766E]" />
                    <span className="font-semibold">{page.name}</span>
                    <span className="ml-auto text-xs text-gray-400">{page.section}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
