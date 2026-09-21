import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from './api'

// Company summary (organisation status, hive count, stock, month income).
// MainLayout polls it, so an officer's approval appears without a reload.
let state = { summary: null, error: '' }
const listeners = new Set()

function publish(next) {
  state = next
  listeners.forEach((listener) => listener())
}

export async function refreshSummary() {
  try {
    publish({ summary: await apiRequest('/company/summary'), error: '' })
  } catch (error) {
    publish({ ...state, error: error.message })
  }
}

export function resetSummary() {
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
