import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from './api'

// Company summary (organisation status, hive count, stock, month income).
// MainLayout polls it, so an officer's approval appears without a reload.
// Cached to this device's storage too: with no signal, a cold start of the app (not just a still-open tab)
// would otherwise have no summary at all, and features gated on it (e.g. offline harvest recording needs to
// know the organisation is approved) would wrongly look unavailable instead of just offline.
const SUMMARY_CACHE_KEY = 'apictech_cached_summary'
const readCachedSummary = () => { try { return JSON.parse(localStorage.getItem(SUMMARY_CACHE_KEY)) } catch { return null } }
const writeCachedSummary = (summary) => { try { localStorage.setItem(SUMMARY_CACHE_KEY, JSON.stringify(summary)) } catch { /* storage full or blocked */ } }

let state = { summary: readCachedSummary(), error: '' }
const listeners = new Set()

function publish(next) {
  state = next
  listeners.forEach((listener) => listener())
}

export async function refreshSummary() {
  try {
    const summary = await apiRequest('/company/summary')
    writeCachedSummary(summary)
    publish({ summary, error: '' })
  } catch (error) {
    // Offline or briefly unreachable: keep whatever summary is already loaded (live or cached) rather than
    // blanking it out, so pages gated on it (e.g. "organisation approved") stay usable.
    publish({ ...state, error: error.message })
  }
}

export function resetSummary() {
  try { localStorage.removeItem(SUMMARY_CACHE_KEY) } catch { /* ignore */ }
  publish({ summary: null, error: '' })
}

export function useSummary({ poll = false } = {}) {
  const [, rerender] = useState(0)

  useEffect(() => {
    const listener = () => rerender((count) => count + 1)
    listeners.add(listener)
    if (!state.summary) refreshSummary()

    const timer = poll ? window.setInterval(refreshSummary, 8000) : null

    return () => {
      listeners.delete(listener)
      if (timer) window.clearInterval(timer)
    }
  }, [poll])

  return state
}

// Loads a resource from the backend; `reload` refetches it after a change.
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: '', loading: true })

  const reload = useCallback(async () => {
    try {
      setState({ data: await apiRequest(path), error: '', loading: false })
    } catch (error) {
      setState((current) => ({ ...current, error: error.message, loading: false }))
    }
  }, [path])

  useEffect(() => { reload() }, [reload])

  return { ...state, reload }
}

export const money = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

export function formatDate(value) {
  if (!value) return '—'
  const text = String(value)
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00` : /^\d{4}-\d{2}-\d{2} \d/.test(text) ? `${text.replace(' ', 'T')}Z` : text)
  return Number.isNaN(date.getTime()) ? text : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}
