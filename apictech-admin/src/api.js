import { useCallback, useEffect, useRef, useState } from 'react'

export const API_URL = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:5000/api`

const TOKEN_KEY = 'apictech_admin_token'
const USER_KEY = 'apictech_admin_user'

export const session = {
  get token() { return localStorage.getItem(TOKEN_KEY) },
  get user() {
    try { return JSON.parse(localStorage.getItem(USER_KEY)) } catch { return null }
  },
  save(token, user) {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  },
}

export async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    // Token expired, or the KVIC head deactivated this officer: sign out.
    if (session.token && (response.status === 401 || (response.status === 403 && /token|no longer active/i.test(payload.message || '')))) {
      session.clear()
      window.dispatchEvent(new Event('admin-session-ended'))
    }

    const error = new Error(payload.message || 'Request failed')
    error.status = response.status
    throw error
  }

  return payload
}

// Loads a resource and keeps it fresh, so changes made in the beekeeper app
// (or by other officers) appear here without a manual reload.
export function useLive(path, { interval = 6000, enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: '', loading: true, updatedAt: null })
  const pathRef = useRef(path)
  pathRef.current = path

  const load = useCallback(async () => {
    if (!enabled || !pathRef.current) return

    const requested = pathRef.current
    try {
      const data = await api(requested)
      if (pathRef.current === requested) setState({ data, error: '', loading: false, updatedAt: new Date() })
    } catch (error) {
      if (pathRef.current === requested) setState((current) => ({ ...current, error: error.message, loading: false }))
    }
  }, [enabled])

  useEffect(() => {
    setState((current) => ({ ...current, loading: true }))
    load()
  }, [path, load])

  useEffect(() => {
    if (!enabled) return undefined

    const tick = () => { if (!document.hidden) load() }
    const timer = window.setInterval(tick, interval)
    document.addEventListener('visibilitychange', tick)

    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [interval, enabled, load])

  return { ...state, refresh: load }
}
