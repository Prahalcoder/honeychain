import {
  TrendingUp,
  BrainCircuit,
  Droplets,
  IndianRupee,
  Wallet,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Info,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import MainLayout from '../layouts/MainLayout'
import { money, useApi } from '../lib/store'

const CONFIDENCE = {
  MEDIUM: { label: 'Medium confidence', tone: 'bg-teal-50 text-teal-700' },
  LOW: { label: 'Low confidence', tone: 'bg-orange-50 text-orange-700' },
  VERY_LOW: { label: 'Very low confidence: little history', tone: 'bg-red-50 text-red-700' },
}

const monthShort = (key) => new Date(`${key}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short' })
const range = (value, format) => `${format(value.low)} – ${format(value.high)}`

export default function Predictions() {
  const { data, loading, error } = useApi('/company/insights')

  if (!data) {
    return (
      <MainLayout title="AI Insights">
        <p className="text-sm text-gray-500">{loading ? 'Analysing your records...' : error}</p>
      </MainLayout>
    )
  }

  const { forecast, economics, insights, history } = data
  const confidence = CONFIDENCE[data.confidence]
  const chart = history.map((row) => ({ month: monthShort(row.month), Income: row.income, Expenses: row.expense }))
  const forecastMonth = new Date(`${forecast.month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

  return (
    <MainLayout title="AI Insights">

      <div>
        <h1 className="text-2xl font-black">
          AI Finance Intelligence
        </h1>

        <p className="mt-1 text-sm text-gray-500">
          Revenue forecasting, expense insights and production economics from your own farm records.
        </p>
      </div>

      <div className="mt-6 rounded-2xl border border-[#c0dfdd] bg-white p-6">

        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">

          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-[#dbedeb] p-3">
              <BrainCircuit size={24} />
            </div>

            <div>
              <h2 className="font-bold">Forecast for {forecastMonth}</h2>
              <p className="mt-1 text-sm leading-6 text-gray-500">
                {data.method} across {data.monthsUsed} month{data.monthsUsed === 1 ? '' : 's'} of your records.
                A decision-support estimate, not a guarantee.
              </p>
            </div>
          </div>

          <span className={`w-fit shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${confidence.tone}`}>{confidence.label}</span>

        </div>

      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">

        <Prediction
          icon={IndianRupee}
          title="Expected Income"
          value={money.format(forecast.income.expected)}
          text={`Likely ${range(forecast.income, (value) => money.format(value))}`}
        />

        <Prediction
          icon={Wallet}
          title="Expected Expenses"
          value={money.format(forecast.expense.expected)}
          text={`Likely ${range(forecast.expense, (value) => money.format(value))}`}
        />

        <Prediction
          icon={TrendingUp}
          title="Expected Profit"
          value={money.format(forecast.profit.expected)}
          text="Income minus expenses"
        />

        <Prediction
          icon={Droplets}
          title="Expected Honey"
          value={`${forecast.honeyKg.expected} kg`}
          text={`Likely ${forecast.honeyKg.low}–${forecast.honeyKg.high} kg`}
        />

      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.3fr_1fr]">

        <section className="rounded-2xl border border-[#c0dfdd] bg-white p-6">
          <h2 className="font-bold">Income and expense trend</h2>
          <p className="mt-1 text-xs text-gray-500">Last six months from your private finance book.</p>
          <div className="mt-5 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#dbeceb" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value) => money.format(value)} />
                <Legend />
                <Bar dataKey="Income" fill="#2f7d78" radius={[5, 5, 0, 0]} />
                <Bar dataKey="Expenses" fill="#e36e4b" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-2xl border border-[#c0dfdd] bg-white p-6">
          <h2 className="font-bold">Production economics</h2>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Mini label="Honey recorded" value={`${economics.totalHoneyKg} kg`} />
            <Mini label="Income per kg" value={economics.incomePerKg === null ? '—' : money.format(economics.incomePerKg)} />
            <Mini label="Cost per kg" value={economics.costPerKg === null ? '—' : money.format(economics.costPerKg)} />
            <Mini label="Total expenses" value={money.format(economics.totalExpense)} />
          </div>

          <h3 className="mt-5 text-sm font-bold">Where the money goes</h3>
          <div className="mt-3 space-y-3">
            {economics.categories.length === 0 && <p className="text-xs text-gray-500">Record expenses to see the breakdown.</p>}
            {economics.categories.map((row) => (
              <div key={row.category}>
                <div className="flex justify-between text-xs">
                  <span className="font-semibold">{row.category}</span>
                  <span>{money.format(row.amount)} · {row.share}%</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-gray-100">
                  <div className="h-full rounded-full bg-[#F97360]" style={{ width: `${row.share}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>

      </div>

      <div className="mt-6 rounded-2xl border border-[#c0dfdd] bg-white p-6">

        <div className="flex items-center gap-2">
          <Sparkles size={19} />
          <h2 className="font-bold">
            AI Insights
          </h2>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {insights.map((insight) => (
            <Insight key={insight.title} insight={insight} />
          ))}
        </div>

        <p className="mt-5 text-xs text-gray-400">Engine: {data.engine}. Forecasts widen when there is little history.</p>

      </div>

    </MainLayout>
  )
}

function Prediction({ icon: Icon, title, value, text }) {
  return (
    <div className="rounded-2xl border border-[#c0dfdd] bg-white p-5">

      <div className="w-fit rounded-xl bg-[#dbedeb] p-3">
        <Icon size={20} />
      </div>

      <p className="mt-4 text-sm text-gray-500">
        {title}
      </p>

      <p className="mt-1 text-2xl font-black">
        {value}
      </p>

      <p className="mt-1 text-xs text-gray-400">
        {text}
      </p>

    </div>
  )
}

function Mini({ label, value }) {
  return (
    <div className="rounded-xl bg-[#f4fbfb] p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 font-black">{value}</p>
    </div>
  )
}

function Insight({ insight }) {
  const icon = insight.level === 'WARNING'
    ? <AlertTriangle size={17} className="text-orange-600" />
    : insight.level === 'GOOD'
      ? <CheckCircle2 size={17} className="text-teal-600" />
      : <Info size={17} className="text-blue-500" />

  return (
    <div className="rounded-xl bg-[#f4fbfb] p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <div>
          <p className="text-sm font-bold">{insight.title}</p>
          <p className="mt-1 text-sm leading-6 text-gray-600">{insight.detail}</p>
        </div>
      </div>
    </div>
  )
}
