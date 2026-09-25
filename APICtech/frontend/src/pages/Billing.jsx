import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Receipt,
  Plus,
  Download,
  Eye,
  CheckCircle2,
  Clock3,
  Trash2,
  X,
} from 'lucide-react'

import MainLayout from '../layouts/MainLayout'
import { apiRequest } from '../lib/api'
import { formatDate, money, refreshSummary, useApi } from '../lib/store'

const today = () => new Date().toLocaleDateString('en-CA')
const fieldClass = 'mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-[#F97360]'
const TONES = { Paid: 'bg-teal-50 text-teal-600', Pending: 'bg-orange-50 text-orange-600', Cancelled: 'bg-gray-100 text-gray-500' }
const SOURCES = [['ALL', 'All sales'], ['MANUAL', 'Sales in person'], ['PORTAL', 'Sales thru portal']]

// Invoices live in the company's private database. Marking one paid books the
// amount as income in Finance (and in the monthly total shared with KVIC).
export default function Billing() {
  const invoiceData = useApi('/company/invoices')
  const buyerData = useApi('/company/buyers')
  const batchData = useApi('/company/batches')
  const stockData = useApi('/company/inventory')
  const pricingData = useApi('/company/pricing')
  const navigate = useNavigate()

  const [showCreate, setShowCreate] = useState(false)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [source, setSource] = useState('ALL')

  const allInvoices = invoiceData.data?.invoices || []
  const invoices = source === 'ALL' ? allInvoices : allInvoices.filter((invoice) => invoice.source === source)
  const seller = invoiceData.data?.seller
  const buyers = buyerData.data || []
  const sum = (status) => invoices.filter((invoice) => invoice.status === status).reduce((total, invoice) => total + invoice.total_inr, 0)

  async function setStatus(invoice, status) {
    setError('')
    try {
      await apiRequest(`/company/invoices/${invoice.id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      await Promise.all([invoiceData.reload(), buyerData.reload(), stockData.reload(), refreshSummary()])
    } catch (statusError) {
      setError(statusError.message)
    }
  }

  return (
    <MainLayout title="Billing">

      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">

        <div>
          <h1 className="text-2xl font-black">Billing</h1>
          <p className="mt-1 text-sm text-gray-500">
            Create invoices and track payment status. A paid invoice is booked as income in Finance.
          </p>
        </div>

        <button
          onClick={() => (buyers.length === 0 ? navigate('/buyers') : setShowCreate(true))}
          className="flex items-center justify-center gap-2 rounded-xl bg-[#F97360] px-5 py-3 text-sm font-bold"
        >
          <Plus size={18} />
          {buyers.length === 0 ? 'Add a buyer first' : 'Create Invoice'}
        </button>

      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Stat title="Total Invoices" value={invoices.length} icon={Receipt} />
        <Stat title="Paid" value={money.format(sum('Paid'))} icon={CheckCircle2} />
        <Stat title="Pending" value={money.format(sum('Pending'))} icon={Clock3} />
      </div>

      {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      <div className="mt-6 overflow-hidden rounded-2xl border border-[#c0dfdd] bg-white">

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 p-6">
          <h2 className="font-bold">Invoices</h2>
          <select value={source} onChange={(event) => setSource(event.target.value)} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold outline-none focus:border-[#F97360]">
            {SOURCES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </div>

        <div className="overflow-x-auto">

          <table className="w-full min-w-[900px]">

            <thead className="bg-[#f4fbfb] text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-6 py-4">Invoice</th>
                <th className="px-6 py-4">Buyer</th>
                <th className="px-6 py-4">Batch</th>
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Actions</th>
              </tr>
            </thead>

            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id} className="border-t border-gray-100">
                  <td className="px-6 py-4 font-bold">
                    {invoice.invoice_number}
                    {invoice.source === 'PORTAL' && <span className="ml-2 rounded-full bg-[#f4fbfb] px-2 py-0.5 text-xs font-bold text-[#2b5b57]">Sellers nearby</span>}
                  </td>
                  <td className="px-6 py-4 text-sm">{invoice.buyer_name}</td>
                  <td className="px-6 py-4 text-sm">{invoice.batch_code || '—'}</td>
                  <td className="px-6 py-4 text-sm">{formatDate(invoice.issue_date)}</td>
                  <td className="px-6 py-4 font-bold">{money.format(invoice.total_inr)}</td>
                  <td className="px-6 py-4">
                    <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${TONES[invoice.status]}`}>{invoice.status}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => setPreview(invoice)} title="View" className="rounded-lg border border-gray-200 p-2"><Eye size={15} /></button>
                      <button onClick={() => printInvoice(invoice, seller)} title="Download / print" className="rounded-lg border border-gray-200 p-2"><Download size={15} /></button>
                      {invoice.status === 'Pending' && (
                        invoice.source === 'PORTAL' ? (
                          <a href="/orders" className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-500">Manage in Orders</a>
                        ) : (
                          <>
                            <button onClick={() => setStatus(invoice, 'Paid')} className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-bold text-teal-700">Mark paid</button>
                            <button onClick={() => setStatus(invoice, 'Cancelled')} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-500">Cancel</button>
                          </>
                        )
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>

          </table>

          {invoices.length === 0 && (
            <p className="p-10 text-center text-sm text-gray-500">
              No invoices yet. {buyers.length === 0 ? 'Add a buyer, then create your first invoice.' : 'Create an invoice for a buyer.'}
            </p>
          )}

        </div>

      </div>

      {showCreate && (
        <CreateInvoice
          buyers={buyers}
          batches={batchData.data || []}
          lots={(stockData.data?.lots || []).filter((lot) => lot.inStock > 0)}
          pricing={pricingData.data}
          onClose={() => setShowCreate(false)}
          onDone={async (created) => {
            setShowCreate(false)
            await Promise.all([invoiceData.reload(), stockData.reload()])
            const fresh = (await apiRequest('/company/invoices')).invoices.find((item) => item.id === created.id)
            if (fresh) setPreview(fresh)
          }}
        />
      )}

      {preview && <InvoiceModal invoice={preview} seller={seller} onClose={() => setPreview(null)} />}

    </MainLayout>
  )
}

function CreateInvoice({ buyers, batches, lots = [], pricing, onClose, onDone }) {
  const [form, setForm] = useState({ buyerId: buyers[0]?.id || '', batchCode: '', issueDate: today(), dueDate: '', gstPercent: '' })
  const [lines, setLines] = useState([{ description: '', quantity: 1, unitPrice: '', packBatchCode: '' }])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))

  const setLine = (index, field, value) => setLines((current) => current.map((line, at) => (at === index ? { ...line, [field]: value } : line)))

  // Choosing a packaging run fills in the description; the quantity is then a number of jars taken from the stock.
  function chooseLot(index, code) {
    const lot = lots.find((item) => item.packBatchCode === code)
    setLines((current) => current.map((line, at) => (at === index
      ? { ...line, packBatchCode: code, ...(lot ? { description: `${lot.honeyType} ${lot.jarSizeGrams} g jar (${lot.packBatchCode})`, quantity: Math.min(Number(line.quantity) || 1, lot.inStock), unitPrice: line.unitPrice || minFor(lot) || '' } : {}) }
      : line)))
  }
  // GST: the standard percentage set by KVIC. It is fixed when the bill takes jars from stock.
  const standardGst = pricing?.gstPercent ?? 0
  const sellsJars = lines.some((line) => line.packBatchCode)
  const gstPercent = sellsJars || form.gstPercent === '' ? standardGst : Number(form.gstPercent) || 0
  const subtotal = lines.reduce((total, line) => total + (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0), 0)
  const gst = (subtotal * gstPercent) / 100

  // The KVIC minimum for one jar of a packaging run, before GST.
  const minFor = (lot) => {
    const perKg = pricing?.guidance?.find((item) => item.honeyType === lot?.honeyType)?.minPricePerKg
    return perKg ? Math.ceil((perKg * lot.jarSizeGrams) / 1000) : 0
  }

  async function submit(event) {
    event.preventDefault()
    setError('')
    setSaving(true)

    try {
      const created = await apiRequest('/company/invoices', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          buyerId: Number(form.buyerId),
          dueDate: form.dueDate || null,
          gstPercent,
          lines: lines.map((line) => ({ description: line.description, quantity: Number(line.quantity), unitPrice: Number(line.unitPrice), ...(line.packBatchCode ? { packBatchCode: line.packBatchCode } : {}) })),
        }),
      })
      await onDone(created)
    } catch (createError) {
      setError(createError.message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">

        <div className="flex justify-between">
          <div>
            <p className="text-xs text-gray-400">BILLING</p>
            <h2 className="text-xl font-black">Create invoice</h2>
          </div>
          <button type="button" onClick={onClose}><X /></button>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold">Buyer
            <select value={form.buyerId} onChange={set('buyerId')} className={fieldClass} required>
              {buyers.map((buyer) => <option key={buyer.id} value={buyer.id}>{buyer.name}</option>)}
            </select>
          </label>
          <label className="block text-sm font-semibold">Batch <span className="font-normal text-gray-400">(optional)</span>
            <select value={form.batchCode} onChange={set('batchCode')} className={fieldClass}>
              <option value="">Not linked to a batch</option>
              {batches.map((batch) => <option key={batch.batch_code} value={batch.batch_code}>{batch.batch_code} · {batch.quantity_kg} kg</option>)}
            </select>
          </label>
          <label className="block text-sm font-semibold">Invoice date
            <input type="date" value={form.issueDate} onChange={set('issueDate')} className={fieldClass} required />
          </label>
          <label className="block text-sm font-semibold">Due date <span className="font-normal text-gray-400">(optional)</span>
            <input type="date" value={form.dueDate} onChange={set('dueDate')} className={fieldClass} />
          </label>
        </div>

        <p className="mt-6 text-xs font-bold uppercase tracking-wide text-gray-400">Items</p>
        <div className="mt-2 space-y-3">
          {lines.map((line, index) => (
            <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_90px_120px_36px]">
              {lots.length > 0 && (
                <select value={line.packBatchCode} onChange={(event) => chooseLot(index, event.target.value)} className={`${fieldClass.replace('mt-1 ', '')} sm:col-span-4`}>
                  <option value="">Not from stock (service, loose honey, other)</option>
                  {lots.map((lot) => <option key={lot.packBatchCode} value={lot.packBatchCode}>Take jars from {lot.packBatchCode} · {lot.honeyType} {lot.jarSizeGrams} g · {lot.inStock} in stock</option>)}
                </select>
              )}
              <input value={line.description} onChange={(event) => setLine(index, 'description', event.target.value)} placeholder="e.g. Natural Honey 500 g jar" className={fieldClass.replace('mt-1 ', '')} required />
              <input type="number" min={line.packBatchCode ? 1 : 0.01} step={line.packBatchCode ? 1 : 0.01} max={line.packBatchCode ? lots.find((lot) => lot.packBatchCode === line.packBatchCode)?.inStock : undefined} value={line.quantity} onChange={(event) => setLine(index, 'quantity', event.target.value)} placeholder="Qty" className={fieldClass.replace('mt-1 ', '')} required />
              <input type="number" min={line.packBatchCode ? minFor(lots.find((lot) => lot.packBatchCode === line.packBatchCode)) : 0} step="0.01" value={line.unitPrice} onChange={(event) => setLine(index, 'unitPrice', event.target.value)} placeholder="Price (₹)" title={line.packBatchCode ? `KVIC minimum ₹${minFor(lots.find((lot) => lot.packBatchCode === line.packBatchCode))} per jar` : ''} className={fieldClass.replace('mt-1 ', '')} required />
              <button type="button" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, at) => at !== index))} className="text-gray-400 hover:text-red-500 disabled:opacity-30"><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setLines((current) => [...current, { description: '', quantity: 1, unitPrice: '', packBatchCode: '' }])} className="mt-3 text-sm font-bold text-[#168481]">+ Add another item</button>

        <div className="mt-5 grid items-end gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold">GST (%) {sellsJars && <span className="font-normal text-gray-400">standard, set by KVIC</span>}
            <input type="number" min="0" max="28" step="0.1" value={sellsJars || form.gstPercent === '' ? standardGst : form.gstPercent} onChange={set('gstPercent')} readOnly={sellsJars} className={`${fieldClass} ${sellsJars ? 'bg-gray-50 text-gray-500' : ''}`} />
            {sellsJars && <span className="mt-1 block text-xs font-normal text-gray-500">Jars are billed with {standardGst}% GST for every keeper. Your price is before GST; the buyer pays the total below. Prices can not go under the KVIC minimum.</span>}
          </label>
          <div className="rounded-xl bg-[#f4fbfb] p-4 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><span>{money.format(subtotal)}</span></div>
            <div className="mt-1 flex justify-between"><span>GST</span><span>{money.format(gst)}</span></div>
            <div className="mt-2 flex justify-between border-t border-[#c0dfdd] pt-2 font-black"><span>Total</span><span>{money.format(subtotal + gst)}</span></div>
          </div>
        </div>

        {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>}

        <button disabled={saving} className="mt-6 w-full rounded-xl bg-[#F97360] py-3 font-bold disabled:opacity-60">
          {saving ? 'Creating...' : 'Create invoice'}
        </button>

      </form>
    </div>
  )
}

function InvoiceBody({ invoice, seller }) {
  return (
    <div className="rounded-xl border border-gray-100 p-6">

      <div className="flex justify-between">
        <div>
          <p className="text-xl font-black">{seller?.name}</p>
          {seller?.fssai && <p className="mt-1 text-xs text-gray-500">FSSAI {seller.fssai}</p>}
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-400">INVOICE</p>
          <p className="font-bold">{invoice.invoice_number}</p>
          <p className="mt-1 text-xs text-gray-500">{formatDate(invoice.issue_date)}{invoice.due_date ? ` · due ${formatDate(invoice.due_date)}` : ''}</p>
        </div>
      </div>

      <div className="my-5 border-t border-gray-100" />

      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <p className="text-xs text-gray-400">BILL FROM</p>
          <p className="mt-2 font-bold">{seller?.name}</p>
          {seller?.address && <p className="text-sm text-gray-500">{seller.address}</p>}
          {seller?.gstin && <p className="text-sm text-gray-500">GSTIN: {seller.gstin}</p>}
        </div>
        <div>
          <p className="text-xs text-gray-400">BILL TO</p>
          <p className="mt-2 font-bold">{invoice.buyer_name}</p>
          {invoice.buyer_address && <p className="text-sm text-gray-500">{invoice.buyer_address}</p>}
          {invoice.buyer_gstin && <p className="text-sm text-gray-500">GSTIN: {invoice.buyer_gstin}</p>}
        </div>
      </div>

      <div className="mt-6 rounded-xl bg-[#f4fbfb] p-4 text-sm">
        {invoice.lines.map((line, index) => (
          <div key={index} className="py-1">
            <div className="flex justify-between gap-4">
              <span>{line.description} <span className="text-gray-400">× {line.quantity} @ {money.format(line.unitPrice)}</span></span>
              <span>{money.format(line.quantity * line.unitPrice)}</span>
            </div>
            {line.jarIds?.length > 0 && <p className="mt-0.5 break-all font-mono text-[11px] text-gray-500">Jar QR codes: {line.jarIds.join(', ')}</p>}
          </div>
        ))}
        <div className="mt-2 flex justify-between border-t border-[#c0dfdd] pt-2"><span>Subtotal</span><span>{money.format(invoice.subtotal_inr)}</span></div>
        <div className="mt-1 flex justify-between"><span>GST ({invoice.gst_percent}%)</span><span>{money.format(invoice.gst_inr)}</span></div>
        <div className="mt-3 flex justify-between border-t border-[#c0dfdd] pt-3 font-black"><span>Total</span><span>{money.format(invoice.total_inr)}</span></div>
      </div>

      {invoice.batch_code && <p className="mt-4 text-xs text-gray-500">Traceable honey batch: {invoice.batch_code}</p>}

    </div>
  )
}

function InvoiceModal({ invoice, seller, onClose }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-black">Invoice preview</h2>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${TONES[invoice.status]}`}>{invoice.status}</span>
          </div>
          <button onClick={onClose}><X /></button>
        </div>
        <InvoiceBody invoice={invoice} seller={seller} />
        <button onClick={() => printInvoice(invoice, seller)} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#F97360] py-3 font-bold">
          <Download size={16} /> Download / print
        </button>
      </div>
    </div>
  )
}

// Opens a clean printable copy; "Save as PDF" in the print dialog downloads it.
function printInvoice(invoice, seller) {
  const escape = (value) => String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]))
  const rows = invoice.lines.map((line) => `<tr><td>${escape(line.description)}${line.jarIds?.length ? `<br><small>Jar QR codes: ${escape(line.jarIds.join(', '))}</small>` : ''}</td><td>${line.quantity}</td><td>${money.format(line.unitPrice)}</td><td>${money.format(line.quantity * line.unitPrice)}</td></tr>`).join('')
  const page = window.open('', '_blank')
  if (!page) return

  page.document.write(`<!doctype html><html><head><title>${escape(invoice.invoice_number)}</title>
    <style>body{font-family:system-ui,sans-serif;margin:40px;color:#122c31}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{padding:8px;border-bottom:1px solid #e5e5e5;text-align:left}td:nth-child(n+2),th:nth-child(n+2){text-align:right}.tot{text-align:right;margin-top:16px;line-height:1.8}h1{margin:0}small{color:#777}</style></head><body>
    <h1>${escape(seller?.name)}</h1><small>${escape(seller?.address)}${seller?.gstin ? ` · GSTIN ${escape(seller.gstin)}` : ''}${seller?.fssai ? ` · FSSAI ${escape(seller.fssai)}` : ''}</small>
    <h2>Invoice ${escape(invoice.invoice_number)}</h2>
    <p>Date: ${escape(formatDate(invoice.issue_date))}${invoice.due_date ? ` · Due: ${escape(formatDate(invoice.due_date))}` : ''}<br>Bill to: <b>${escape(invoice.buyer_name)}</b>${invoice.buyer_gstin ? ` · GSTIN ${escape(invoice.buyer_gstin)}` : ''}${invoice.batch_code ? `<br>Honey batch: ${escape(invoice.batch_code)}` : ''}</p>
    <table><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="tot">Subtotal ${money.format(invoice.subtotal_inr)}<br>GST (${invoice.gst_percent}%) ${money.format(invoice.gst_inr)}<br><b>Total ${money.format(invoice.total_inr)}</b></div>
    <script>window.onload=function(){window.print()}</script></body></html>`)
  page.document.close()
}

function Stat({ title, value, icon: Icon }) {
  return (
    <div className="rounded-2xl border border-[#c0dfdd] bg-white p-5">
      <div className="w-fit rounded-xl bg-[#dbedeb] p-3">
        <Icon size={20} />
      </div>
      <p className="mt-4 text-sm text-gray-500">{title}</p>
      <p className="text-2xl font-black">{value}</p>
    </div>
  )
}
