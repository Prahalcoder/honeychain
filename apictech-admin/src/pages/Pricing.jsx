import { useState } from 'react'
import { Percent, Save } from 'lucide-react'

import { api, useLive } from '../api'
import { Empty, ErrorNote, LiveBadge, PageIntro, PanelHeader, fmtDateTime, inr } from '../ui'

// Prices and GST for every keeper. The head office sets them; state and regional officers can read them.
export default function Pricing({ user, notify }) {
  const data = useLive('/admin/pricing', { interval: 10000 })
  const canEdit = Boolean(data.data?.canEdit)
  const guidance = data.data?.guidance || []
  const [gst, setGst] = useState('')

  async function saveGst() {
    try {
      const result = await api('/admin/pricing/gst', { method: 'PUT', body: { gstPercent: Number(gst) } })
      notify(`Standard GST is now ${result.gstPercent}% for every keeper`)
      setGst('')
      data.refresh()
    } catch (error) { notify(error.message) }
  }

  return (
    <>
      <PageIntro
        eyebrow="Governance"
        title="Prices & GST"
        copy={canEdit
          ? 'Set the standard GST on jars and the minimum price of each honey type. They apply to every registered keeper at once: billing, Sellers nearby and the keeper profile all follow them.'
          : 'The standard GST on jars and the minimum prices are set by the KVIC head office. Every keeper follows them.'}
        right={<LiveBadge updatedAt={data.updatedAt} error={data.error} />}
      />

      {data.error && <ErrorNote>{data.error}</ErrorNote>}

      <section className="panel">
        <PanelHeader title="Standard GST on jars" subtitle="Added on top of a keeper's price on every bill and on Sellers nearby" />
        <div className="pricing-gst">
          <div className="pricing-gst-value"><Percent size={22} /> <strong>{data.data?.gstPercent ?? '…'}%</strong></div>
          {canEdit ? (
            <div className="pricing-edit">
              <input type="number" min="0" max="28" step="0.5" value={gst} onChange={(event) => setGst(event.target.value)} placeholder="New GST %, for example 18" />
              <button className="primary-button" disabled={gst === ''} onClick={saveGst}><Save size={16} /> Set for everyone</button>
            </div>
          ) : data.data ? (
            <small>Only the KVIC head office can change it.</small>
          ) : null}
        </div>
      </section>

      <section className="panel">
        <PanelHeader title="Minimum price per kg" subtitle="Keepers may charge more, never less. A jar's minimum is the per-kg price times the jar's weight, before GST." />
        {guidance.length === 0 ? <Empty>No honey types yet.</Empty> : (
          <div className="pricing-table">
            <div className="pricing-head"><span>Honey type</span><span>Minimum per kg</span><span>500 g jar</span><span>Last changed</span><span /></div>
            {guidance.map((row) => <GuidanceRow key={row.honeyType} row={row} canEdit={canEdit} notify={notify} refresh={data.refresh} />)}
          </div>
        )}
      </section>
    </>
  )
}

function GuidanceRow({ row, canEdit, notify, refresh }) {
  const [value, setValue] = useState(String(row.minPricePerKg))

  async function save() {
    try {
      const result = await api('/admin/pricing/guidance', { method: 'PUT', body: { honeyType: row.honeyType, minPricePerKg: Number(value) } })
      notify(`${row.honeyType}: minimum ${inr(Number(value))} per kg${result.listingsRaised ? `, ${result.listingsRaised} listing(s) raised to it` : ''}`)
      refresh()
    } catch (error) { notify(error.message) }
  }

  return (
    <div className="pricing-row">
      <strong>{row.honeyType}</strong>
      {canEdit
        ? <input type="number" min="1" step="1" value={value} onChange={(event) => setValue(event.target.value)} />
        : <span>{inr(row.minPricePerKg)}</span>}
      <span>{inr(Math.ceil(row.minPricePerKg / 2))}</span>
      <small>{row.updatedAt ? fmtDateTime(row.updatedAt) : '—'}</small>
      {canEdit ? <button className="secondary-button" disabled={Number(value) === row.minPricePerKg} onClick={save}>Save</button> : <span />}
    </div>
  )
}
