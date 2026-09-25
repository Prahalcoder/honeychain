import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Blocks, Check, ClipboardCheck, History, IndianRupee, LayoutDashboard, LifeBuoy, Leaf,
  LogOut, Megaphone, Menu, Percent, QrCode, ScanSearch, Store, UserCog, X,
} from 'lucide-react'

import { session, useLive } from './api'
import { LanguageToggle } from './i18n'
import NotificationMenu from './components/NotificationMenu'
import { LiveBadge, ROLE_LABELS, initials, jurisdictionLabel } from './ui'
import Login from './pages/Login'
import SplashScreen from './pages/SplashScreen'
import PwaUpdate from './PwaUpdate'
import Dashboard from './pages/Dashboard'
import Requests from './pages/Requests'
import Organizations from './pages/Organizations'
import Reports from './pages/Reports'
import Chain from './pages/Chain'
import Inspections from './pages/Inspections'
import Notices from './pages/Notices'
import Help from './pages/Help'
import Officers from './pages/Officers'
import Activity from './pages/Activity'
import Pricing from './pages/Pricing'
import JarAlerts from './pages/JarAlerts'

const PAGE_TITLES = {
  dashboard: 'Control room',
  requests: 'Review queue',
  organizations: 'Organizations',
  inspections: 'Inspections',
  notices: 'Notice board',
  help: 'Help & roles',
  reports: 'Income & production',
  chain: 'Blockchain',
  officers: 'Officers',
  activity: 'Activity & approvals',
  pricing: 'Prices & GST',
  'jar-alerts': 'Copied QR codes',
}

function navFor(user, pending, inspectionsDue, openSupport, jarAlerts) {
  const groups = [
    {
      label: 'Overview',
      items: [
        { id: 'dashboard', label: 'Control room', icon: LayoutDashboard },
        { id: 'requests', label: 'Review queue', icon: ClipboardCheck, count: pending },
        { id: 'notices', label: 'Notice board', icon: Megaphone },
      ],
    },
    {
      label: 'Network',
      items: [
        { id: 'organizations', label: 'Organizations', icon: Store },
        { id: 'inspections', label: 'Inspections', icon: ScanSearch, count: inspectionsDue },
        { id: 'jar-alerts', label: 'Copied QR codes', icon: QrCode, count: jarAlerts },
        { id: 'chain', label: 'Blockchain', icon: Blocks },
        ...(user.role !== 'REGIONAL_OFFICER' ? [{ id: 'reports', label: 'Income & production', icon: IndianRupee }] : []),
      ],
    },
    {
      label: 'Governance',
      items: [
        ...(user.role !== 'REGIONAL_OFFICER' ? [{ id: 'officers', label: 'Officers', icon: UserCog }] : []),
        { id: 'pricing', label: 'Prices & GST', icon: Percent },
        { id: 'activity', label: user.role === 'REGIONAL_OFFICER' ? 'My activity' : 'Activity & approvals', icon: History },
        { id: 'help', label: 'Help & roles', icon: LifeBuoy, count: openSupport },
      ],
    },
  ]

  return groups
}

export default function App() {
  const [user, setUser] = useState(session.user)
  const [showSplash, setShowSplash] = useState(true)

  useEffect(() => {
    const ended = () => setUser(null)
    window.addEventListener('admin-session-ended', ended)
    return () => window.removeEventListener('admin-session-ended', ended)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 2200)
    return () => clearTimeout(timer)
  }, [])

  if (showSplash) return <SplashScreen />
  if (!user || !session.token) return <><PwaUpdate /><Login onLogin={setUser} /></>

  return <><PwaUpdate /><Shell user={user} onSignOut={() => { session.clear(); setUser(null) }} /></>
}

// The sidebar keeps its scroll position when you pick a page.
let sidebarScroll = 0

function Shell({ user, onSignOut }) {
  const sidebarRef = useRef(null)
  const [page, setPage] = useState('dashboard')
  const [params, setParams] = useState({})
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [toast, setToast] = useState('')

  const overview = useLive('/admin/overview', { interval: 5000 })
  const pending = overview.data ? overview.data.pendingOrganizations + overview.data.pendingLabReviews + (overview.data.pendingClosures || 0) : 0

  useLayoutEffect(() => {
    if (sidebarRef.current) sidebarRef.current.scrollTop = sidebarScroll
  })

  const notify = useCallback((message) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 3000)
  }, [])

  const go = useCallback((target, nextParams = {}) => {
    setPage(target)
    setParams(nextParams)
    setSidebarOpen(false)
  }, [])

  const shared = { user, notify, go, params, overview: overview.data, refreshOverview: overview.refresh }
  const pages = {
    dashboard: <Dashboard {...shared} />,
    requests: <Requests {...shared} />,
    organizations: <Organizations {...shared} />,
    inspections: <Inspections {...shared} />,
    notices: <Notices {...shared} />,
    help: <Help {...shared} />,
    reports: <Reports {...shared} />,
    chain: <Chain {...shared} />,
    officers: <Officers {...shared} />,
    activity: <Activity {...shared} />,
    pricing: <Pricing {...shared} />,
    'jar-alerts': <JarAlerts {...shared} />,
  }

  return (
    <div className="app-shell">
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-hidden="true" />}
      <aside ref={sidebarRef} onScroll={(event) => { sidebarScroll = event.currentTarget.scrollTop }} className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <img className="brand-logo" src="/honeychain-logo.png" alt="" />
          <div><strong>Honey Chain</strong><span>Admin · KVIC Portal</span></div>
          <button className="mobile-close icon-button" onClick={() => setSidebarOpen(false)} aria-label="Close menu"><X size={19} /></button>
        </div>
        <div className="workspace-switcher"><div className="workspace-dot" /><div><span>{ROLE_LABELS[user.role]}</span><strong>{jurisdictionLabel(user)}</strong></div></div>
        <nav>
          {navFor(user, pending, overview.data?.inspectionsDue || 0, overview.data?.openSupport || 0, overview.data?.openJarAlerts || 0).map((group) => (
            <div className="nav-group" key={group.label}>
              <p>{group.label}</p>
              {group.items.map((item) => {
                const Icon = item.icon
                return (
                  <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => go(item.id)}>
                    <Icon size={18} /><span>{item.label}</span>{item.count > 0 && <b>{item.count}</b>}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="profile">
            <div className="avatar">{initials(user.name)}</div>
            <div><strong>{user.name}</strong><span>{ROLE_LABELS[user.role]}</span></div>
          </div>
          <button className="signout" onClick={onSignOut}><LogOut size={15} />Sign out</button>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu icon-button" onClick={() => setSidebarOpen(true)} aria-label="Open menu"><Menu size={22} /></button>
          <div className="breadcrumb"><span>Honey Chain Admin</span><strong>{PAGE_TITLES[page]}</strong></div>
          <div className="top-actions">
            <LanguageToggle />
            <div className="connection"><LiveBadge updatedAt={overview.updatedAt} error={overview.error} /></div>
            <NotificationMenu go={go} />
            <div className="mini-avatar">{initials(user.name)}</div>
          </div>
        </header>
        <div className="page-wrap">{pages[page]}</div>
      </main>
      {toast && <div className="toast"><Check size={17} />{toast}</div>}
    </div>
  )
}
