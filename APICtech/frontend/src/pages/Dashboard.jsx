import { Link, useNavigate } from 'react-router-dom'
import {
  Boxes,
  Droplets,
  QrCode,
  IndianRupee,
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import MainLayout from '../layouts/MainLayout'
import NoticeBoard from '../components/NoticeBoard'
import { formatDate, money, useApi, useSummary } from '../lib/store'

function readUser() {
  try {
    return JSON.parse(localStorage.getItem('apictech_user')) || {}
  } catch {
    return {}
  }
}

const monthShort = (key) => new Date(`${key}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short' })

export default function Dashboard() {
  const navigate = useNavigate()
  const user = readUser()
  const { summary } = useSummary()
  const hiveData = useApi('/company/hives')
  const harvestData = useApi('/company/harvests')
  const financeData = useApi('/company/finance')
  const notificationData = useApi('/company/notifications')

  const hives = hiveData.data || []
  const harvests = harvestData.data || []
  const notifications = (notificationData.data || []).slice(0, 4)
  const chart = (financeData.data?.trend || []).map((row) => ({
    month: monthShort(row.month),
    income: row.income,
  }))

  const stats = [
    {
      title: 'Total Hives',
      value: summary?.hives.total ?? '—',
      subtitle: 'All registered hives',
      icon: Boxes,
      tone: 'from-[#f86751] to-[#F97360]',
    },
    {
      title: 'Honey Stock',
      value: summary ? `${Math.round(summary.honeyStockKg * 10) / 10} kg` : '—',
      subtitle: `${summary?.batches ?? 0} traceable batches`,
      icon: Droplets,
      tone: 'from-[#34d3c8] to-[#05968c]',
    },
    {
      title: 'Bottle QR Codes',
      value: summary?.bottles ?? '—',
      subtitle: 'Created on the KVIC chain',
      icon: QrCode,
      tone: 'from-[#60a5fa] to-[#4f46e5]',
    },
    {
      title: 'Income This Month',
      value: summary ? money.format(summary.monthIncome) : '—',
      subtitle: 'Shared with KVIC as a monthly total',
      icon: IndianRupee,
      tone: 'from-[#fb7185] to-[#e11d48]',
    },
  ]

  return (
    <MainLayout title="Dashboard">

      <div className="mb-8">
        <h1 className="text-2xl font-black">
          {`Good morning, ${(user.name || 'there').split(' ')[0]}`}
        </h1>

        <p className="mt-1 text-sm text-gray-500">
          Here's what's happening with {summary?.organization?.name || 'your apiary'} today.
        </p>
      </div>

      {summary?.inspection && (
        <Link to="/inspections" className="mb-6 flex items-center gap-4 rounded-2xl border border-orange-300 bg-orange-50 p-4 hover:bg-orange-100">
          <div className="rounded-xl bg-white p-3"><CalendarClock size={22} className="text-orange-700" /></div>
          <div className="flex-1">
            <p className="font-black text-orange-900">
              {summary.inspection.today ? 'Inspection today' : summary.inspection.tomorrow ? 'Reminder: inspection tomorrow' : 'Inspection scheduled'}
            </p>
            <p className="text-sm text-orange-900/80">
              {`${summary.inspection.code} · ${summary.inspection.date}${summary.inspection.time ? ` at ${summary.inspection.time}` : ''}. Keep your licence, records and stock ready.`}
            </p>
          </div>
          <span className="text-sm font-bold text-orange-900">{summary.inspection.acknowledged ? 'View' : 'Acknowledge'}</span>
        </Link>
      )}

      <div className="mb-6 grid gap-6 xl:grid-cols-3">
        <section className="relative min-h-72 overflow-hidden rounded-3xl bg-[#182d34] shadow-[0_24px_60px_rgba(18,42,47,0.28)] xl:col-span-2">
          <img src="/img/bee-1.jpg" alt="A honey bee flying near the hive" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#102625]/90 via-[#102625]/55 to-transparent" />
          <div className="hex-pattern absolute inset-0 opacity-25" />
          <div className="relative flex min-h-72 max-w-xl flex-col justify-center p-7 text-white sm:p-10">
            <span className="mb-3 w-fit rounded-full bg-[#f86751] px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-[#10262a]">
              Apiary today
            </span>
            <h2 className="text-3xl font-black leading-tight sm:text-4xl">
              Every hive tells a story. Keep yours healthy.
            </h2>
            <p className="mt-3 text-sm leading-6 text-white/85 sm:text-base">
              Track hive health, honey production, lab results and farm finances from one clear workspace.
            </p>
          </div>
        </section>

        <NoticeBoard className="min-h-72" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon

          return (
            <div
              key={stat.title}
              className="stat-card rounded-2xl border border-[#c0dedc] bg-white p-5 shadow-[0_10px_28px_rgba(30,71,80,0.1)] transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(30,71,80,0.18)]"
            >
              <div className="flex items-center justify-between">
                <div className={`rounded-2xl bg-gradient-to-br p-3 text-white shadow-lg ${stat.tone}`}>
                  <Icon size={22} />
                </div>

                {stat.title === 'Honey Stock' && (
                  <span className="flex items-center gap-1 text-xs font-semibold text-teal-600">
                    <ArrowUpRight size={14} />
                    live
                  </span>
                )}
              </div>

              <p className="mt-5 text-sm text-gray-500">
                {stat.title}
              </p>

              <p className="mt-1 text-2xl font-black">
                {stat.value}
              </p>

              <p className="mt-1 text-xs text-gray-400">
                {stat.subtitle}
              </p>
            </div>
          )
        })}
      </div>

      <div className="mt-6 rounded-2xl border border-[#c0dfdd] bg-white p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-bold">Income trend</h2>
            <p className="mt-1 text-sm text-gray-500">Monthly income recorded in your private finance book.</p>
          </div>
          <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-teal-700">Last 6 months</span>
        </div>
        <div className="mt-5 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chart}>
              <defs>
                <linearGradient id="honeyFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#F97360" stopOpacity={0.55} />
                  <stop offset="95%" stopColor="#F97360" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#dbeceb" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value) => money.format(value)} />
              <Area type="monotone" dataKey="income" name="Income" stroke="#0F766E" fill="url(#honeyFill)" strokeWidth={3} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">

        <div className="rounded-2xl border border-[#c0dfdd] bg-white p-6 xl:col-span-2">

          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-bold">Apiary Overview</h2>
              <p className="text-xs text-gray-500">
                Your registered hives
              </p>
            </div>

            <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-600">
              {hives.length} Hives
            </span>
          </div>

          <div className="mt-5 space-y-3">
            {hives.length === 0 && <p className="text-sm text-gray-500">No hives yet. Add your first hive from My Hives.</p>}
            {hives.map((hive) => (
              <HiveRow key={hive.hive_code} id={hive.hive_code} name={hive.name} location={hive.location} health="Device not connected" />
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-[#c0dfdd] bg-white p-6">
          <h2 className="font-bold">Quick Actions</h2>

          <div className="mt-5 space-y-3">
            <QuickAction text="Record Harvest" onClick={() => navigate('/harvest')} />
            <QuickAction text="Share Lab Result" onClick={() => navigate('/laboratory')} />
            <QuickAction text="Create Bottle QR Codes" onClick={() => navigate('/qr-management')} />
            <QuickAction text="Add Transaction" onClick={() => navigate('/finance')} />
          </div>
        </div>

      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">

        <div className="rounded-2xl border border-[#c0dfdd] bg-white p-6">
          <h2 className="font-bold">Recent Activity</h2>

          <div className="mt-5 space-y-5">
            {harvests.slice(0, 3).map((harvest) => (
              <Activity
                key={harvest.batch_code}
                title={`Batch ${harvest.batch_code} recorded (${harvest.quantity_kg} kg)`}
                time={formatDate(harvest.harvest_date)}
              />
            ))}
            {notifications.map((item) => (
              <Activity key={item.id} title={item.title} time={formatDate(item.time)} />
            ))}
            {harvests.length === 0 && notifications.length === 0 && (
              <p className="text-sm text-gray-500">Activity from your harvests and officer decisions will appear here.</p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-[#c0dfdd] bg-white p-6">
          <h2 className="font-bold">Attention Required</h2>

          {summary?.organization?.status && summary.organization.status !== 'APPROVED' && (
            <div className="mt-5 rounded-xl bg-orange-50 p-4">
              <div className="flex gap-3">
                <AlertTriangle className="text-orange-600" size={20} />
                <div>
                  <p className="font-semibold">Organisation {summary.organization.status === 'PENDING_APPROVAL' ? 'awaiting approval' : summary.organization.status.toLowerCase()}</p>
                  <p className="mt-1 text-xs text-gray-600">
                    Harvests, lab results and QR codes need your regional officer's approval.
                  </p>
                </div>
              </div>
            </div>
          )}

          {summary?.pendingLabReviews > 0 && (
            <div className="mt-4 rounded-xl bg-[#f4fbfb] p-4">
              <p className="font-semibold">{summary.pendingLabReviews} lab result(s) awaiting officer review</p>
              <p className="mt-1 text-xs text-gray-600">You'll be notified when they are verified.</p>
            </div>
          )}

          <div className="mt-4 rounded-xl bg-orange-50 p-4">
            <div className="flex gap-3">
              <AlertTriangle className="text-orange-600" size={20} />

              <div>
                <p className="font-semibold">
                  IoT devices not connected
                </p>

                <p className="mt-1 text-xs text-gray-600">
                  Connect an ESP32 to a hive to begin real-time monitoring.
                </p>
              </div>
            </div>
          </div>
        </div>

      </div>

    </MainLayout>
  )
}

function HiveRow({ id, name, location, health }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-gray-100 p-4">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-[#dbedeb] p-2.5">
          🐝
        </div>

        <div>
          <p className="font-semibold">{id} <span className="font-normal text-gray-400">· {name}</span></p>
          <p className="text-xs text-gray-500">{location}</p>
        </div>
      </div>

      <div className="text-right">
        <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-600">
          Active
        </span>

        <p className="mt-1 text-[11px] text-gray-400">
          {health}
        </p>
      </div>
    </div>
  )
}

function QuickAction({ text, onClick }) {
  return (
    <button onClick={onClick} className="w-full rounded-xl border border-gray-100 p-3 text-left text-sm font-medium hover:bg-[#f4fbfb]">
      {text}
    </button>
  )
}

function Activity({ title, time }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-1 h-2 w-2 rounded-full bg-[#F97360]" />

      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-gray-400">{time}</p>
      </div>
    </div>
  )
}
