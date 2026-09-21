import { useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { Download, Lock, PackagePlus, QrCode, ScanLine } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import MainLayout from '../layouts/MainLayout'
import { apiRequest } from '../lib/api'
import { formatDate, refreshSummary, useApi, useSummary } from '../lib/store'

const inputClass = 'mt-2 w-full rounded-xl border border-gray-200 px-3 py-3 text-sm font-normal outline-none focus:border-[#F97360]'

export default function QRManagement() {
  const batchData = useApi('/company/batches')
  const packBatchData = useApi('/platform/pack-batches')
  const { summary } = useSummary()
  const approved = summary?.organization?.status === 'APPROVED'

  const [packs, setPacks] = useState([])
  const [packsTitle, setPacksTitle] = useState('')
  const [form, setForm] = useState({ batchCode: '', productName: 'Natural Honey', jarSizeGrams: 500, quantityToPack: 1 })
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const batches = batchData.data || []
  const packBatches = packBatchData.data || []
  const selectedCode = form.batchCode || batches[0]?.batch_code || ''
  const selected = batches.find((batch) => batch.batch_code === selectedCode)
  const navigate = useNavigate()
  // Packaging stays locked until the regional officer verifies the lab certificate.
  const locked = Boolean(selected) && !selected.packaging.unlocked

  // How many bottles of this size still fit in the selected batch.
  const jarSize = Number(form.jarSizeGrams)
  const maxBottles = useMemo(() => {
    if (!selected || !Number.isInteger(jarSize) || jarSize < 1) return 0
    return Math.floor(selected.capacity.remainingGrams / jarSize)
  }, [selected, jarSize])

  const requested = Number(form.quantityToPack)
  const overLimit = requested > maxBottles

  const renderPacks = async (items) => Promise.all(items.map(async (pack) => ({
    ...pack,
    image: await QRCode.toDataURL(pack.qrUrl, { width: 180, margin: 1, errorCorrectionLevel: 'H' }),
  })))

  const createPackagingBatch = async (event) => {
    event.preventDefault()
    setError('')
    setMessage('')
    setIsSaving(true)

    try {
      const packBatch = await apiRequest('/platform/pack-batches', {
        method: 'POST',
        body: JSON.stringify({ ...form, batchCode: selectedCode, jarSizeGrams: jarSize, quantityToPack: requested }),
      })
      const result = await apiRequest(`/platform/pack-batches/${packBatch.packBatchCode}/packs`, {
        method: 'POST',
        body: JSON.stringify({ quantity: requested }),
      })
      setPacks(await renderPacks(result.packs))
      setPacksTitle(packBatch.packBatchCode)
      setMessage(`${result.packs.length} bottle QR codes created and sealed on the chain.`)
      await Promise.all([batchData.reload(), packBatchData.reload(), refreshSummary()])
    } catch (saveError) {
      setError(saveError.message)
      // The server is the authority on capacity; refresh so the limit shown is current.
      batchData.reload()
    } finally {
      setIsSaving(false)
    }
  }

  const openPackBatch = async (code) => {
    setError('')
    try {
      const items = await apiRequest(`/platform/pack-batches/${code}/packs`)
      setPacks(await renderPacks(items))
      setPacksTitle(code)
      setMessage('')
    } catch (loadError) {
      setError(loadError.message)
    }
  }

  const downloadCsv = () => {
    const csv = ['pack_id,qr_url', ...packs.map((pack) => `${pack.packId || pack.pack_id},${pack.qrUrl}`)].join('\n')
    const link = document.createElement('a')
    link.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`
    link.download = `apictech-${packsTitle || 'pack'}-ids.csv`
    link.click()
  }

  const totalBottles = packBatches.reduce((sum, item) => sum + item.packs_created, 0)

  return (
    <MainLayout title="QR Management">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#199995]">Packaging identity</p>
        <h1 className="mt-2 text-2xl font-black">QR Management</h1>
        <p className="mt-1 text-sm text-gray-500">Packaging unlocks after your regional officer verifies the lab certificate. Every bottle then gets a unique QR code on the blockchain, limited by the honey in the batch. Consumers scan it to verify authenticity.</p>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Stat title="Source Batches" value={batches.length} icon={PackagePlus} />
        <Stat title="Bottle QRs Created" value={totalBottles} icon={QrCode} />
        <Stat title="Verification" value="Public" icon={ScanLine} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <form onSubmit={createPackagingBatch} className="rounded-2xl border border-[#c6e2e0] bg-white p-6">
          <h2 className="font-bold">New packaging batch</h2>
          <p className="mt-1 text-xs text-gray-500">QR records are created and chained as part of this action.</p>
          {batchData.loading && <p className="mt-5 text-sm text-gray-500">Loading source batches...</p>}
          {!batchData.loading && batches.length === 0 && <p className="mt-5 rounded-xl bg-[#eff7f6] p-4 text-sm text-gray-500">Record a harvest first. Each harvest becomes a batch you can package.</p>}

          <label className="mt-5 block text-sm font-semibold">Source batch</label>
          <select value={selectedCode} onChange={(event) => setForm({ ...form, batchCode: event.target.value })} className={inputClass} required>
            {batches.map((batch) => <option key={batch.batch_code} value={batch.batch_code}>{batch.packaging.unlocked ? '' : '🔒 '}{batch.batch_code} · {batch.quantity_kg} kg</option>)}
          </select>

          {locked && (
            <div className="mt-3 rounded-xl border border-orange-200 bg-orange-50 p-3 text-xs text-orange-900">
              <p className="flex items-center gap-2 font-bold"><Lock size={14} />Packaging is locked for {selected.batch_code}</p>
              <p className="mt-1 leading-5">{selected.packaging.reason}</p>
              <button type="button" onClick={() => navigate('/laboratory')} className="mt-2 rounded-lg bg-[#F97360] px-3 py-1.5 font-bold">Go to Laboratory</button>
            </div>
          )}

          {selected && (
            <div className="mt-3 rounded-xl bg-[#f4fbfb] p-3 text-xs text-gray-600">
              <div className="flex justify-between"><span>Harvested</span><b>{selected.quantity_kg} kg ({selected.capacity.totalGrams.toLocaleString('en-IN')} g)</b></div>
              <div className="mt-1 flex justify-between"><span>Already reserved for bottles</span><b>{selected.capacity.packedGrams.toLocaleString('en-IN')} g ({selected.capacity.packedBottles} bottles)</b></div>
              <div className="mt-1 flex justify-between"><span>Honey left to pack</span><b>{selected.capacity.remainingGrams.toLocaleString('en-IN')} g</b></div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
                <div className="h-full rounded-full bg-[#F97360]" style={{ width: `${Math.min(100, (selected.capacity.packedGrams / selected.capacity.totalGrams) * 100)}%` }} />
              </div>
            </div>
          )}

          <label className="mt-4 block text-sm font-semibold">Product name
            <input value={form.productName} onChange={(event) => setForm({ ...form, productName: event.target.value })} className={inputClass} required />
          </label>
          <label className="mt-4 block text-sm font-semibold">Jar size (grams)
            <input type="number" min="10" max="25000" value={form.jarSizeGrams} onChange={(event) => setForm({ ...form, jarSizeGrams: event.target.value })} className={inputClass} required />
          </label>
          <label className="mt-4 block text-sm font-semibold">Number of bottles
            <input type="number" min="1" max={Math.max(1, maxBottles)} value={form.quantityToPack} onChange={(event) => setForm({ ...form, quantityToPack: event.target.value })} className={inputClass} required />
          </label>
          <p className={`mt-2 text-xs ${locked ? 'hidden' : overLimit || maxBottles === 0 ? 'font-semibold text-red-600' : 'text-gray-500'}`}>
            {maxBottles === 0
              ? 'No honey is left in this batch for bottles of this size.'
              : `You can create at most ${maxBottles} QR code${maxBottles === 1 ? '' : 's'} of ${jarSize || '…'} g from this batch.`}
          </p>

          {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>}
          {message && <p className="mt-4 rounded-xl bg-teal-50 p-3 text-sm text-teal-700">{message}</p>}
          <button
            disabled={isSaving || !selected || !approved || locked || overLimit || maxBottles === 0 || requested < 1}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#0F766E] py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            <PackagePlus size={17} />
            {isSaving ? 'Creating records...' : 'Create packaging batch'}
          </button>
          {!approved && <p className="mt-2 text-xs text-orange-700">QR codes can be created once your organisation is approved.</p>}
        </form>

        <div className="space-y-6">
          <section className="rounded-2xl border border-[#c6e2e0] bg-white p-6">
            <div className="flex items-center justify-between gap-4">
              <div><h2 className="font-bold">Bottle QR records {packsTitle && <span className="text-xs font-normal text-gray-500">· {packsTitle}</span>}</h2><p className="mt-1 text-xs text-gray-500">Each code maps to one unique pack ID.</p></div>
              <button type="button" onClick={downloadCsv} disabled={!packs.length} className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold disabled:opacity-40"><Download size={14} />CSV</button>
            </div>
            {!packs.length && <p className="mt-8 rounded-xl bg-[#eff7f6] p-5 text-sm text-gray-500">Create a packaging batch, or open one below, to see its QR labels.</p>}
            <div className="mt-5 grid max-h-155 gap-4 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {packs.map((pack) => {
                const id = pack.packId || pack.pack_id
                return <article key={id} className="rounded-xl border border-gray-100 p-3"><img src={pack.image} alt={id} className="mx-auto h-32 w-32" /><p className="mt-2 break-all text-center text-[11px] font-bold">{id}</p><a href={pack.image} download={`${id}.png`} className="mt-3 flex items-center justify-center gap-1 rounded-lg bg-[#eff7f6] py-2 text-[11px] font-bold"><Download size={12} />Download</a></article>
              })}
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-[#c6e2e0] bg-white">
            <div className="border-b border-gray-100 p-6"><h2 className="font-bold">Your packaging batches</h2><p className="mt-1 text-xs text-gray-500">Saved on the chain. Open one to view or reprint its labels.</p></div>
            {packBatches.length === 0 ? <p className="p-6 text-sm text-gray-500">No packaging batches yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-left">
                  <thead className="bg-[#f4fbfb] text-xs uppercase text-gray-500"><tr>{['Pack batch', 'Source batch', 'Jar', 'QR codes', 'Created', ''].map((heading) => <th key={heading} className="px-6 py-3">{heading}</th>)}</tr></thead>
                  <tbody>{packBatches.map((item) => (
                    <tr key={item.pack_batch_code} className="border-t border-gray-100">
                      <td className="px-6 py-3 text-sm font-bold">{item.pack_batch_code}</td>
                      <td className="px-6 py-3 text-sm">{item.batch_code}</td>
                      <td className="px-6 py-3 text-sm">{item.jar_size_grams} g</td>
                      <td className="px-6 py-3 text-sm">{item.packs_created} / {item.quantity_to_pack}</td>
                      <td className="px-6 py-3 text-sm">{formatDate(item.created_at)}</td>
                      <td className="px-6 py-3"><button onClick={() => openPackBatch(item.pack_batch_code)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-bold">View QRs</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </MainLayout>
  )
}

function Stat({ title, value, icon: Icon }) {
  return <div className="rounded-2xl border border-[#c6e2e0] bg-white p-5"><div className="w-fit rounded-xl bg-[#dbedeb] p-3"><Icon size={20} /></div><p className="mt-4 text-sm text-gray-500">{title}</p><p className="text-2xl font-black">{value}</p></div>
}
