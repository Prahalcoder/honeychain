import {
  ShoppingBag,
  LayoutDashboard,
  Boxes,
  Droplets,
  Package,
  FlaskConical,
  Truck,
  Users,
  Receipt,
  Wallet,
  TrendingUp,
  Link2,
  QrCode,
  Bell,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Landmark,
  LifeBuoy,
} from 'lucide-react'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { apiRequest } from '../lib/api'
import { refreshSummary, resetSummary, useSummary } from '../lib/store'
import { LanguageToggle } from '../i18n'
import NotificationBell from '../components/NotificationBell'
import QuickSearch from '../components/QuickSearch'
import RegistrationDetails from '../components/registration/RegistrationDetails'

// A registration does not activate the account. Until the regional officer
// approves the organisation, the keeper only sees this status screen.
const STATUS_SCREENS = {
  PENDING_APPROVAL: {
    tone: 'border-orange-200 bg-orange-50 text-orange-900',
    title: 'Your registration is under review',
    text: 'Your regional KVIC officer is verifying your organisation details and credentials. You will get access to Honey Chain Keeper as soon as it is approved. This page updates automatically.',
  },
  REJECTED: {
    tone: 'border-red-200 bg-red-50 text-red-800',
    title: 'Registration not approved',
    text: 'Your registration was not accepted into the KVIC monitoring chain. Contact your regional officer if you believe this is a mistake.',
  },
  SUSPENDED: {
    tone: 'border-red-200 bg-red-50 text-red-800',
    title: 'Organisation suspended',
    text: 'Access is paused while KVIC reviews your organisation. Contact your regional officer.',
  },
  CLOSURE_PENDING: {
    tone: 'border-orange-200 bg-orange-50 text-orange-900',
    title: 'Closure in progress',
    text: 'Your regional KVIC officer is completing the government formalities for closing your organisation (FSSAI surrender, GST cancellation and other clearances). No new records can be added meanwhile.',
  },
  CLOSED: {
    tone: 'border-gray-200 bg-gray-50 text-gray-700',
    title: 'Organisation closed',
    text: 'This organisation has been formally closed with KVIC.',
  },
}

function readUser() {
  try {
    return JSON.parse(localStorage.getItem('apictech_user')) || {}
  } catch {
    return {}
  }
}

const menuSections = [
  {
    title: 'OVERVIEW',
    items: [
      { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    ],
  },
  {
    title: 'TRACEABILITY',
    items: [
      { name: 'Traceability', path: '/traceability', icon: Link2 },
      { name: 'QR Management', path: '/qr-management', icon: QrCode, retailOnly: true },
    ],
  },
  {
    title: 'BEEKEEPING',
    items: [
      { name: 'My Hives', path: '/hives', icon: Boxes },
      { name: 'Harvest', path: '/harvest', icon: Droplets },
      { name: 'Inventory', path: '/inventory', icon: Package },
    ],
  },
  {
    title: 'BUSINESS',
    items: [
      { name: 'Laboratory', path: '/laboratory', icon: FlaskConical },
      { name: 'Supply Chain', path: '/supply-chain', icon: Truck },
      { name: 'Buyers', path: '/buyers', icon: Users },
      { name: 'Orders', path: '/orders', icon: ShoppingBag },
      { name: 'Billing', path: '/billing', icon: Receipt },
      { name: 'Finance', path: '/finance', icon: Wallet },
      { name: 'AI Insights', path: '/predictions', icon: TrendingUp },
    ],
  },
  {
    title: 'SUPPORT',
    items: [
      { name: 'Government Schemes', path: '/schemes', icon: Landmark },
      { name: 'Inspections', path: '/inspections', icon: ClipboardCheck },
      { name: 'Help & Support', path: '/help', icon: LifeBuoy },
    ],
  },
  {
    title: 'SYSTEM',
    items: [
      { name: 'Notifications', path: '/notifications', icon: Bell },
      { name: 'Settings', path: '/settings', icon: Settings },
    ],
  },
]

// The menu keeps its scroll position when you move between pages.
let menuScroll = 0

// Pages cache their own data (apictech_cached_*) so the app still has something to show with no signal.
// It is not scoped per account, so it must not survive a log-out, or the next login on this device could
// briefly see the previous keeper's cached hives, harvests, etc.
function clearCachedData() {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('apictech_cached_')) localStorage.removeItem(key)
  }
}

export default function MainLayout({ children, title }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [showRegistration, setShowRegistration] = useState(false)
  const menuRef = useRef(null)
  const navigate = useNavigate()
  const user = readUser()
  const { summary, error: summaryError } = useSummary({ poll: true })
  const organization = summary?.organization
  const gate = organization && STATUS_SCREENS[organization.status]

  useLayoutEffect(() => {
    if (menuRef.current) menuRef.current.scrollTop = menuScroll
  })

  const logout = () => {
    localStorage.removeItem('apictech_token')
    localStorage.removeItem('apictech_user')
    clearCachedData()
    resetSummary()
    navigate('/login')
  }

  useEffect(() => {
    if (!localStorage.getItem('apictech_token') || (user.role && user.role !== 'BEEKEEPER')) {
      navigate(localStorage.getItem('apictech_token') && user.role === 'WHOLESALER' ? '/trade' : '/login', { replace: true })
    }
  }, [navigate, user.role])

  // The account was deactivated or the session expired.
  useEffect(() => {
    if (/token|no longer active|authentication required/i.test(summaryError)) logout()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryError])

  // Don't mount pages (and fire their API calls) until we know the organisation is approved.
  if (!organization && !summaryError) {
    return (
      <div className="app-shell flex min-h-screen items-center justify-center text-sm text-gray-500">
        Loading your workspace…
      </div>
    )
  }

  if (gate) {
    return (
      <div className="app-shell flex min-h-screen flex-col items-center justify-center gap-6 p-6 text-[#122c31]">
        <div className="fixed right-5 top-5 z-50"><LanguageToggle /></div>
        <div className="w-full max-w-lg rounded-3xl border border-[#c6e2e0] bg-white p-8 text-center shadow-[0_20px_60px_rgba(21,49,55,0.08)]">
          <img src="/apictech-logo.png" alt="Honey Chain" className="mx-auto h-20 w-20 rounded-full" />
          <p className="mt-6 text-xs font-bold uppercase tracking-[0.2em] text-[#199995]">Honey Chain Keeper</p>
          <h1 className="mt-2 text-2xl font-black">{gate.title}</h1>
          <p className="mt-1 text-sm font-semibold text-gray-500">{organization.name} · {organization.region}, {organization.state}</p>
          <div className={`mt-6 rounded-2xl border p-4 text-left ${gate.tone}`}>
            <p className="text-sm">{gate.text}</p>
            {organization.closure && organization.closure.initiatedBy !== 'BEEKEEPER' && (
              <p className="mt-3 text-sm font-semibold">Closure notice: {organization.closure.reason}</p>
            )}
            {organization.reviewNote && organization.status !== 'PENDING_APPROVAL' && (
              <p className="mt-3 text-sm font-semibold">Officer's note: {organization.reviewNote}</p>
            )}
          </div>
          {summary.inspection && (
            <p className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-3 text-left text-sm text-orange-900">
              {`Inspection notice ${summary.inspection.code}: ${summary.inspection.date}${summary.inspection.time ? ` at ${summary.inspection.time}` : ''}. Keep your records and stock ready.`}
            </p>
          )}
          {organization.status === 'PENDING_APPROVAL' && (
            <p className="mt-4 flex items-center justify-center gap-2 text-xs text-gray-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#F97360]" />
              Checking for the officer's decision…
            </p>
          )}
          <div className="mt-6 flex justify-center gap-3">
            {organization.status === 'CLOSURE_PENDING' && (
              <button
                onClick={async () => { try { await apiRequest('/company/closure', { method: 'DELETE' }); await refreshSummary() } catch { /* started by an officer */ } }}
                className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-bold hover:bg-gray-50"
              >
                Withdraw request
              </button>
            )}
            {['PENDING_APPROVAL', 'REJECTED'].includes(organization.status) && (
              <button onClick={() => setShowRegistration(!showRegistration)} className="rounded-xl bg-[#0F766E] px-5 py-2.5 text-sm font-bold text-white">
                {showRegistration ? 'Hide my application' : 'My application & documents'}
              </button>
            )}
            <button onClick={logout} className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-bold hover:bg-gray-50">
              Sign Out
            </button>
          </div>
        </div>
        {/* While waiting, the applicant can still correct details and add a missing document. */}
        {showRegistration && (
          <div className="w-full max-w-4xl rounded-3xl border border-[#c6e2e0] bg-white p-6 text-left">
            <RegistrationDetails />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="app-shell min-h-screen text-[#122c31]">
      {mobileOpen && <div className="hc-backdrop lg:hidden" onClick={() => setMobileOpen(false)} aria-hidden="true" />}

      <aside
        className={`hc-side fixed left-0 top-0 z-50 h-screen w-68 transition-transform duration-300 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}
      >
        <div className="flex h-full flex-col">
          <div className="hc-brand">
            <img src="/apictech-logo.png" alt="Honey Chain" />
            <div>
              <b>Honey Chain</b>
              <span>Keeper</span>
            </div>
            <button className="hc-close lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu">
              <X size={20} />
            </button>
          </div>

          <nav ref={menuRef} onScroll={(event) => { menuScroll = event.currentTarget.scrollTop }} className="side-scroll hc-nav" aria-label="Main menu">
            {menuSections.map((section) => (
              <div key={section.title}>
                <p className="hc-navlabel">{section.title}</p>

                {section.items.filter((item) => !item.retailOnly || organization?.sellingMode !== 'WHOLESALE').map((item) => {
                  const Icon = item.icon

                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      onClick={() => setMobileOpen(false)}
                      className={({ isActive }) => `hc-navitem ${isActive ? 'is-active' : ''}`}
                    >
                      <Icon size={18} />
                      <span>{item.name}</span>
                    </NavLink>
                  )
                })}
              </div>
            ))}
          </nav>

          <div className="hc-user">
            <div className="av">{(user.name || '?').charAt(0).toUpperCase()}</div>
            <div className="who">
              <b>{user.name || 'Beekeeper'}</b>
              <small>{organization?.name || 'Beekeeper'}</small>
            </div>
            <button onClick={logout} title="Sign out" aria-label="Sign out">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      <div className="lg:pl-68">
        <header className="sticky top-0 z-40 flex min-h-20 items-center justify-between border-b border-[#c6e2e0] bg-[#fafdfd]/90 px-4 shadow-[0_4px_20px_rgba(29,70,78,0.05)] backdrop-blur-xl lg:px-9">

          <div className="flex items-center gap-3">
            <button
              className="lg:hidden"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={22} />
            </button>

            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-[#929083]">
                <span>Workspace</span>
                <ChevronRight size={13} />
                <span className="text-[#122c31]">{title}</span>
              </div>
              <h2 className="mt-1 text-2xl font-black tracking-tight">{title}</h2>
              <p className="hidden text-xs text-[#929083] sm:block">
                Live operations console
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <LanguageToggle />
            <QuickSearch sections={menuSections} />

            <NotificationBell />

            <Link to="/help" className="rounded-xl p-2.5 text-[#3a5c5f] transition hover:bg-[#d7eae9]" title="Help & Support" aria-label="Help and support">
              <CircleHelp size={20} />
            </Link>

            <div className="flex items-center gap-2 border-l border-[#c6e2e0] pl-3 sm:pl-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F97360] font-black text-[#14272e] shadow-sm">
                {(user.name || '?').charAt(0).toUpperCase()}
              </div>

              <div className="hidden sm:block">
                <p className="text-sm font-bold">{user.name || 'Beekeeper'}</p>
                <p className="text-[11px] font-semibold text-[#929083]">{organization?.name || 'Beekeeper'}</p>
              </div>
            </div>
          </div>
        </header>

        <main className="app-main min-h-[calc(100vh-80px)] p-4 lg:p-9">
          {children}
        </main>
      </div>
    </div>
  )
}