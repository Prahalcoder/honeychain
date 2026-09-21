import { useMemo, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, Banknote, CalendarDays, Download, Landmark, Lock, Plus, Trash2, Wallet } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import MainLayout from '../layouts/MainLayout'
import { apiRequest } from '../lib/api'
import { formatDate, money, refreshSummary, useApi } from '../lib/store'

const periods = ['This month', 'Last month', 'This quarter']
const budgets = { Labor: 30000, Packaging: 20000, Maintenance: 15000 }
const monthKey = (offset) => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth() + offset, 1).toLocaleDateString('en-CA').slice(0, 7)
}
const monthShort = (key) => new Date(`${key}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short' })
const today = () => new Date().toLocaleDateString('en-CA')

function inPeriod(entry, period) {
  const month = entry.entry_date.slice(0, 7)
  if (period === 'This month') return month === monthKey(0)
  if (period === 'Last month') return month === monthKey(-1)
  return [monthKey(0), monthKey(-1), monthKey(-2)].includes(month)
}

export default function FinanceWorkspace() {
  const finance = useApi('/company/finance')
  const [period, setPeriod] = useState('This month')
  const [showAdd, setShowAdd] = useState(false)

  const entries = finance.data?.entries || []
  const trend = (finance.data?.trend || []).map((row) => ({ month: monthShort(row.month), revenue: row.income, spend: row.expense }))

  const periodData = useMemo(() => {
    const scoped = entries.filter((entry) => inPeriod(entry, period))
    const sum = (rows) => rows.reduce((total, item) => total + item.amount_inr, 0)
    const income = sum(scoped.filter((item) => item.type === 'INCOME'))
    const expenses = sum(scoped.filter((item) => item.type === 'EXPENSE'))
    const spent = (category) => sum(scoped.filter((item) => item.type === 'EXPENSE' && item.category === category))
    const multiplier = period === 'This quarter' ? 3 : 1

    return {
      income,
      expenses,
      profit: income - expenses,
      cash: sum(entries.filter((item) => item.type === 'INCOME')) - sum(entries.filter((item) => item.type === 'EXPENSE')),
      budget: Object.fromEntries(Object.entries(budgets).map(([category, limit]) => [category, { spent: spent(category), limit: limit * multiplier }])),
    }
  }, [period, entries])

  async function addEntry(item) {
    await apiRequest('/company/finance', { method: 'POST', body: JSON.stringify(item) })
    await Promise.all([finance.reload(), refreshSummary()])
    setShowAdd(false)
  }

  async function removeEntry(id) {
    await apiRequest(`/company/finance/${id}`, { method: 'DELETE' })
    await Promise.all([finance.reload(), refreshSummary()])
  }

  function exportCsv() {
    const csv = ['date,type,category,description,amount_inr', ...entries.map((item) => [item.entry_date, item.type, item.category, `"${item.description.replaceAll('"', '""')}"`, item.amount_inr].join(','))].join('\n')
    const link = document.createElement('a')
    link.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`
    link.download = 'finance-entries.csv'
    link.click()
  }

  return <MainLayout title="Finance">
    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center"><div><h1 className="text-2xl font-black">Finance</h1><p className="mt-1 text-sm text-gray-500">Understand cash flow, profitability, and operating costs across the apiary.</p></div><button onClick={() => setShowAdd(true)} className="flex items-center justify-center gap-2 rounded-xl bg-[#F97360] px-5 py-3 text-sm font-bold"><Plus size={18} /> Add Transaction</button></div>
    <div className="mt-4 flex items-start gap-3 rounded-2xl border border-[#c0dfdd] bg-[#f4fbfb] p-4 text-xs leading-5 text-gray-600"><Lock size={16} className="mt-0.5 shrink-0 text-[#0F766E]" /><p>Your transactions are stored in your company's private database. Only your <b>monthly income total</b> is shared with KVIC state officers; individual entries, buyers and expenses are never shared.</p></div>
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3"><div className="flex gap-2">{periods.map((item) => <button key={item} onClick={() => setPeriod(item)} className={`rounded-xl px-4 py-2 text-xs font-bold ${period === item ? 'bg-[#F97360]' : 'bg-white text-gray-500'}`}>{item}</button>)}</div><span className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold"><CalendarDays size={15} /> {period}</span></div>
    <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Stat title="Revenue" value={money.format(periodData.income)} icon={ArrowUpRight} tone="green" /><Stat title="Operating costs" value={money.format(periodData.expenses)} icon={ArrowDownLeft} tone="red" /><Stat title="Net profit" value={money.format(periodData.profit)} icon={Banknote} tone="gold" /><Stat title="Cash position" value={money.format(periodData.cash)} icon={Wallet} tone="blue" /></div>
    <div className="mt-6 grid gap-5 xl:grid-cols-[1.4fr_1fr]"><section className="rounded-2xl border border-[#c0dfdd] bg-white p-6"><div className="flex items-center justify-between"><div><h2 className="font-bold">Cash flow overview</h2><p className="mt-1 text-xs text-gray-500">Income versus costs for {period.toLowerCase()}.</p></div><Landmark size={22} className="text-[#0F766E]" /></div><div className="mt-6 space-y-5"><FlowBar label="Sales income" value={periodData.income} total={Math.max(periodData.income, periodData.expenses)} color="bg-teal-500" /><FlowBar label="Operations and labor" value={periodData.expenses} total={Math.max(periodData.income, periodData.expenses)} color="bg-red-400" /><div className="rounded-xl bg-[#f4fbfb] p-4"><div className="flex justify-between text-sm"><span>Net margin</span><strong>{periodData.income ? `${Math.round((periodData.profit / periodData.income) * 100)}%` : '--'}</strong></div><div className="mt-3 h-3 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-[#F97360]" style={{ width: `${periodData.income ? Math.max(0, Math.min(100, (periodData.profit / periodData.income) * 100)) : 0}%` }} /></div></div></div></section><section className="rounded-2xl border border-[#c0dfdd] bg-white p-6"><div className="flex items-start justify-between gap-3"><div><h2 className="font-bold">Budget watch</h2><p className="mt-1 text-xs text-gray-500">Record each spend to keep these totals current.</p></div><button onClick={() => setShowAdd(true)} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#F97360] px-3 py-2 text-xs font-bold"><Plus size={14} /> Add spend</button></div><div className="mt-5 space-y-4">{Object.entries(periodData.budget).map(([label, { spent, limit }]) => <Budget key={label} label={label} spent={spent} budget={limit} />)}</div></section></div>
    <section className="mt-6 rounded-2xl border border-[#c0dfdd] bg-white p-6"><div className="flex items-center justify-between"><div><h2 className="font-bold">Six-month financial trend</h2><p className="mt-1 text-sm text-gray-500">Compare sales income with operating spend.</p></div><Landmark size={22} className="text-[#0F766E]" /></div><div className="mt-5 h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={trend}><CartesianGrid strokeDasharray="3 3" stroke="#dbeceb" /><XAxis dataKey="month" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} /><Tooltip formatter={(value) => money.format(value)} /><Legend /><Bar dataKey="revenue" name="Revenue" fill="#2f7d78" radius={[5, 5, 0, 0]} /><Bar dataKey="spend" name="Spend" fill="#e36e4b" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div></section>
    <section className="mt-6 overflow-hidden rounded-2xl border border-[#c0dfdd] bg-white"><div className="flex items-center justify-between border-b border-gray-100 p-6"><div><h2 className="font-bold">Recent transactions</h2><p className="mt-1 text-xs text-gray-500">Ledger entries are separate from customer invoices.</p></div><button onClick={exportCsv} disabled={!entries.length} className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold disabled:opacity-40"><Download size={15} /> Export</button></div><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left"><thead className="bg-[#f4fbfb] text-xs uppercase text-gray-500"><tr>{['Date', 'Description', 'Category', 'Type', 'Amount', ''].map((heading) => <th key={heading} className="px-6 py-4">{heading}</th>)}</tr></thead><tbody>{entries.map((item) => <tr key={item.id} className="border-t border-gray-100"><td className="px-6 py-4 text-sm">{formatDate(item.entry_date)}</td><td className="px-6 py-4 font-semibold">{item.description}</td><td className="px-6 py-4 text-sm text-gray-500">{item.category}</td><td className="px-6 py-4"><span className={`rounded-full px-3 py-1.5 text-xs font-bold ${item.type === 'INCOME' ? 'bg-teal-50 text-teal-600' : 'bg-red-50 text-red-600'}`}>{item.type === 'INCOME' ? 'Income' : 'Expense'}</span></td><td className={`px-6 py-4 font-bold ${item.type === 'INCOME' ? 'text-teal-700' : 'text-red-600'}`}>{item.type === 'INCOME' ? '+' : '-'}{money.format(item.amount_inr)}</td><td className="px-6 py-4"><button onClick={() => removeEntry(item.id)} title="Delete entry" className="text-gray-400 hover:text-red-500"><Trash2 size={16} /></button></td></tr>)}</tbody></table>{entries.length === 0 && <p className="p-10 text-center text-sm text-gray-500">No transactions yet. Add your first sale or expense.</p>}</div></section>
    {showAdd && <AddTransaction categories={finance.data?.categories || []} onClose={() => setShowAdd(false)} onAdd={addEntry} />}
  </MainLayout>
}

function Stat({ title, value, icon: Icon, tone }) { const styles = { green: 'bg-teal-100 text-teal-700', red: 'bg-red-100 text-red-700', gold: 'bg-[#dbedeb] text-[#168884]', blue: 'bg-blue-100 text-blue-700' }; return <div className="rounded-2xl border border-[#c0dfdd] bg-white p-5"><div className={`w-fit rounded-xl p-3 ${styles[tone]}`}><Icon size={20} /></div><p className="mt-4 text-sm text-gray-500">{title}</p><p className="text-2xl font-black">{value}</p></div> }
function FlowBar({ label, value, total, color }) { return <div><div className="flex justify-between text-sm"><span className="font-semibold">{label}</span><b>{money.format(value)}</b></div><div className="mt-2 h-3 rounded-full bg-gray-100"><div className={`h-full rounded-full ${color}`} style={{ width: `${total ? (value / total) * 100 : 0}%` }} /></div></div> }
function Budget({ label, spent, budget }) { const percent = Math.round((spent / budget) * 100); return <div><div className="flex items-center justify-between gap-2 text-sm"><span>{label}</span><span className="font-bold">{money.format(spent)} / {money.format(budget)}</span></div><div className="mt-2 h-2 rounded-full bg-gray-100"><div className={`h-full rounded-full ${percent > 85 ? 'bg-red-400' : 'bg-[#F97360]'}`} style={{ width: `${Math.min(percent, 100)}%` }} /></div></div> }

function AddTransaction({ categories, onClose, onAdd }) {
  const [form, setForm] = useState({ type: 'EXPENSE', category: 'Labor', description: '', amount: '', entryDate: today() })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))
  const fieldClass = 'mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5'

  async function submit(event) {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      await onAdd({ ...form, amount: Number(form.amount) })
    } catch (addError) {
      setError(addError.message)
      setSaving(false)
    }
  }

  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"><form onSubmit={submit} className="w-full max-w-md rounded-2xl bg-white p-6"><div className="flex items-start justify-between"><div><p className="text-xs text-gray-400">CASH FLOW</p><h2 className="text-xl font-black">Add transaction</h2></div><button type="button" onClick={onClose}>Close</button></div><label className="mt-6 block text-sm font-semibold">Type<select value={form.type} onChange={set('type')} className={fieldClass}><option value="EXPENSE">Expense</option><option value="INCOME">Income</option></select></label><label className="mt-4 block text-sm font-semibold">Description<input value={form.description} onChange={set('description')} className={fieldClass} placeholder="What was it for?" required /></label><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="block text-sm font-semibold">Amount (₹)<input type="number" min="1" step="0.01" value={form.amount} onChange={set('amount')} className={fieldClass} placeholder="0" required /></label><label className="block text-sm font-semibold">Date<input type="date" max={today()} value={form.entryDate} onChange={set('entryDate')} className={fieldClass} required /></label></div><label className="mt-4 block text-sm font-semibold">Category<select value={form.category} onChange={set('category')} className={fieldClass}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>{error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>}<button disabled={saving} className="mt-6 w-full rounded-xl bg-[#F97360] py-3 font-bold disabled:opacity-60">{saving ? 'Saving...' : 'Save transaction'}</button></form></div>
}
