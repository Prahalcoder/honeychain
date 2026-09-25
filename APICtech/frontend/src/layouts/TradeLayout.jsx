import { useCallback, useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { ClipboardList, LogOut, PackageCheck, Store, UserRound } from 'lucide-react'

import { apiRequest } from '../lib/api'
import { resetSummary } from '../lib/store'
import { LanguageToggle } from '../i18n'
import RegistrationDetails from '../components/registration/RegistrationDetails'

// The wholesaler / trader / packer workspace: buy lab-verified loose honey from registered beekeepers. Before the
// regional officer approves the company only the status and the registration record (to add a missing
// document) are shown, like the keeper app's status screen.

const STATUS = {
  PENDING_APPROVAL: { tone: 'border-orange-200 bg-orange-50 text-orange-900', title: 'Your registration is under review', text: 'Your regional KVIC officer is checking your GST, FSSAI, trade licence and the other documents. The honey market opens as soon as you are approved. This page updates automatically.' },
  REJECTED: { tone: 'border-red-200 bg-red-50 text-red-800', title: 'Registration not approved', text: 'Your registration was not accepted. Contact your regional officer if you believe this is a mistake.' },
  SUSPENDED: { tone: 'border-red-200 bg-red-50 text-red-800', title: 'Company suspended', text: 'Buying is paused while KVIC reviews your company. Contact your regional officer.' },
  CLOSURE_PENDING: { tone: 'border-orange-200 bg-orange-50 text-orange-900', title: 'Closure in progress', text: 'Your company is being closed with KVIC.' },
  CLOSED: { tone: 'border-gray-200 bg-gray-50 text-gray-700', title: 'Company closed', text: 'This company has been closed with KVIC.' },
}

const NAV = [
  { to: '/trade', label: 'Honey market', icon: Store, end: true },
  { to: '/trade/offers', label: 'My offers', icon: ClipboardList },
  { to: '/trade/receipts', label: 'Received honey', icon: PackageCheck },
  { to: '/trade/profile', label: 'Profile', icon: UserRound },
]

function readUser() {
  try { return JSON.parse(localStorage.getItem('apictech_user')) || {} } catch { return {} }
}

export function useTradeSummary() {
  const [state, setState] = useState({ summary: null, error: '' })
  const reload = useCallback(async () => {
    try { setState({ summary: await apiRequest('/trade/summary'), error: '' }) } catch (error) { setState((current) => ({ ...current, error: error.message })) }
  }, [])
  useEffect(() => {
    reload()
    const timer = window.setInterval(reload, 10000)
    return () => window.clearInterval(timer)
  }, [reload])
  return { ...state, reload }
}

export default function TradeLayout({ title, children, trade }) {
  const navigate = useNavigate()
  const user = readUser()
  const { summary, error } = trade

  const logout = useCallback(() => {
    localStorage.removeItem('apictech_token')
    localStorage.removeItem('apictech_user')
    resetSummary()
    navigate('/login')
  }, [navigate])

  useEffect(() => {
    if (!localStorage.getItem('apictech_token') || user.role !== 'WHOLESALER') navigate(user.role === 'BEEKEEPER' ? '/dashboard' : '/login', { replace: true })
  }, [navigate, user.role])

  useEffect(() => {
    if (/token|no longer active|authentication required/i.test(error)) logout()
  }, [error, logout])

  const organization = summary?.organization
  const gate = organization && STATUS[organization.status]

  const header = (
    <header className="sticky top-0 z-40 border-b border-[#c6e2e0] bg-[#fafdfd]/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <img src="/apictech-logo.png" alt="Honey Chain" className="h-10 w-10 rounded-full" />
          <div>
            <p className="text-sm font-black leading-tight">Honey Chain Trade</p>
            <p className="text-[11px] font-semibold text-[#5d7f80]">{organization?.name || user.organization?.name || 'Wholesaler'}{organization ? ` · ${organization.region}, ${organization.state}` : ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LanguageToggle />
          <button onClick={logout} className="flex items-center gap-2 rounded-xl border border-[#c6e2e0] px-3 py-2 text-xs font-bold hover:bg-white" title="Sign out"><LogOut size={15} /> Sign out</button>
        </div>
      </div>
      {!gate && organization && (
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2" aria-label="Wholesaler menu">
          {NAV.map((item) => {
            const Icon = item.icon
            return (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold ${isActive ? 'bg-[#0F766E] text-white' : 'text-gray-600 hover:bg-[#e6f3f2]'}`}>
                <Icon size={16} /> {item.label}
              </NavLink>
            )
          })}
        </nav>
      )}
    </header>
  )

  if (!summary) {
    return <div className="app-shell flex min-h-screen items-center justify-center text-sm text-gray-500">{error || 'Loading your workspace…'}</div>
  }

  if (gate) {
    return (
      <div className="app-shell min-h-screen text-[#122c31]">
        {header}
        <main className="mx-auto grid max-w-4xl gap-6 p-4 lg:p-8">
          <div className={`rounded-2xl border p-5 ${gate.tone}`}>
            <h1 className="text-xl font-black">{gate.title}</h1>
            <p className="mt-1 text-sm">{gate.text}</p>
            {organization.reviewNote && organization.status !== 'PENDING_APPROVAL' && <p className="mt-2 text-sm font-semibold">Officer's note: {organization.reviewNote}</p>}
            {organization.status === 'PENDING_APPROVAL' && <p className="mt-3 flex items-center gap-2 text-xs"><span className="h-2 w-2 animate-pulse rounded-full bg-[#F97360]" /> Checking for the officer's decision…</p>}
          </div>
          <div className="rounded-2xl border border-[#c0dfdd] bg-white p-6"><RegistrationDetails /></div>
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell min-h-screen text-[#122c31]">
      {header}
      <main className="mx-auto max-w-6xl p-4 lg:p-8">
        <h1 className="mb-5 text-2xl font-black">{title}</h1>
        {children}
      </main>
    </div>
  )
}
