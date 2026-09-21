export const API_URL =
  import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:5000/api`

export const BEEHIVE_API_URL =
  import.meta.env.VITE_BEEHIVE_API_URL || 'http://localhost:5001/api'

const PUBLIC_VERIFICATION_URL =
  import.meta.env.VITE_PUBLIC_VERIFICATION_URL || `${API_URL}/qr`

export function getToken() {
  return localStorage.getItem('apictech_token')
}

export async function apiRequest(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  }

  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(payload.message || 'Request failed')
  }

  return payload
}

export function getPublicApiUrl(path) {
  if (path.startsWith('/qr/')) {
    return `${PUBLIC_VERIFICATION_URL}${path.slice('/qr'.length)}`
  }

  return `${API_URL}${path}`
}