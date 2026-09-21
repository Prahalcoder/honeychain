import { useState } from 'react'
import { Download, IndianRupee, QrCode, Boxes } from 'lucide-react'

import { useLive } from '../api'
import { Bars, Empty, LiveBadge, Metric, PageIntro, PanelHeader, downloadCsv, inr, kg, monthLabel, num } from '../ui'

// Monthly income, honey produced and bottles per company. Visible to state
// officers and the KVIC head; income arrives as monthly totals only.
export default function Reports({ user, go }) {
  const [month, setMonth] = useState('')
  const report = useLive(`/admin/reports/organizations${month ? `?month=${month}` : ''}`, { interval: 6000 })

  if (user.role === 'REGIONAL_OFFICER') return <Empty>Income reports are available to state officers and the KVIC head.</Empty>
  if (!report.data) return <Empty>{report.error || 'Loading report…'}</Empty>

  const { rows, totals, months, series } = report.data
  const selected = report.data.month

  function exportCsv() {
    downloadCsv(`income-production-${selected}.csv`, [
      ['Organisation', 'Code', 'State', 'Region', 'Honey harvested (kg)', 'Bottles this month', 'Bottles total', 'Income (INR)'],
      ...rows.map((row) => [row.name, row.code, row.state, row.region, row.honeyKgInMonth, row.bottlesInMonth, row.bottlesTotal, row.incomeInr]),
    ])
  }

  return (
    <>
      <PageIntro
        eyebrow="State and national oversight"
        title="Income & production"
        copy="Monthly income reported by each keeper, the honey they harvested and the bottles they created."
        right={<LiveBadge updatedAt={report.updatedAt} error={report.error} />}
      />

      <div className="toolbar">
        <label className="field" style={{ margin: 0 }}>
          <select value={selected} onChange={(event) => setMonth(event.target.value)}>
            {months.map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}
          </select>
        </label>
        <button className="secondary-button" onClick={exportCsv}><Download size={16} />Export CSV</button>
      </div>

      <section className="metric-grid">
        <Metric label="Income reported" value={inr(totals.incomeInr)} note={monthLabel(selected)} icon={IndianRupee} tone="gold" />
        <Metric label="Honey harvested" value={kg(totals.honeyKgInMonth)} note={monthLabel(selected)} icon={Boxes} tone="green" />
        <Metric label="Bottles this month" value={num(totals.bottlesInMonth)} note="QR codes created" icon={QrCode} tone="blue" />
        <Metric label="Bottles all time" value={num(totals.bottlesTotal)} note={`${rows.length} companies`} icon={QrCode} tone="rose" />
      </section>

      <section className="panel table-panel">
        <PanelHeader title={`Companies · ${monthLabel(selected)}`} subtitle="Income comes from each company's private books as a monthly total" />
        {rows.length === 0 ? <Empty>No approved companies in your jurisdiction yet.</Empty> : (
          <div className="table-scroll">
            <table className="dtable">
              <thead><tr><th>Company</th><th>Region</th><th className="num">Honey (kg)</th><th className="num">Bottles this month</th><th className="num">Bottles total</th><th className="num">Income</th><th /></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td><strong>{row.name}</strong><small>{row.code}</small></td>
                    <td>{row.region}, {row.state}</td>
                    <td className="num">{num(Math.round(row.honeyKgInMonth * 10) / 10)}</td>
                    <td className="num">{num(row.bottlesInMonth)}</td>
                    <td className="num">{num(row.bottlesTotal)}</td>
                    <td className="num"><strong>{inr(row.incomeInr)}</strong></td>
                    <td><button className="link-btn" onClick={() => go('chain', { tab: 'batches', orgId: row.id })}>Blockchain</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="chart-pair">
        <section className="panel"><PanelHeader title="Income, last 12 months" subtitle="All companies in scope" /><Bars series={series} valueKey="incomeInr" format={(value) => (value >= 1000 ? `${Math.round(value / 1000)}k` : `${value}`)} /></section>
        <section className="panel"><PanelHeader title="Honey produced, last 12 months" subtitle="Kilograms harvested" /><Bars series={series} valueKey="honeyKg" format={(value) => `${Math.round(value)}`} tone="gold" /></section>
      </div>
    </>
  )
}
