import {
  AlertTriangle, ArrowUpRight, Boxes, ChevronRight, ClipboardCheck,
  FlaskConical, IndianRupee, Megaphone, QrCode, ShieldCheck, Store, UserCog,
} from 'lucide-react'

import { useLive } from '../api'
import { Bars, Empty, Metric, PageIntro, PanelHeader, StatusPill, fmtDate, inr, jurisdictionLabel, kg, num } from '../ui'
import { NoticeCard } from './Notices'

const hours = (value) => (value === null || value === undefined ? '—' : value < 1 ? `${Math.round(value * 60)} min` : value < 48 ? `${value.toFixed(1)} h` : `${(value / 24).toFixed(1)} d`)

export default function Dashboard({ user, overview, go }) {
  const notices = useLive('/admin/announcements?limit=4', { interval: 10000 })
  const analytics = useLive(user.role === 'REGIONAL_OFFICER' ? null : '/admin/analytics/regions', { interval: 8000 })

  if (!overview) return <Empty>Loading the latest figures…</Empty>

  const { organizations, chain, series } = overview
  const showIncome = overview.monthIncomeInr !== undefined
  const intact = chain.integrity.valid

  return (
    <>
      <section className="hero-row">
        <div className="hero-banner">
          <img src="/img/bee-90.jpg" alt="" />
          <div className="hero-shade" />
          <div className="hero-copy">
            <span className="hero-kicker">{jurisdictionLabel(user)}</span>
            <h1>{`Welcome, ${user.name}.`}</h1>
            <p>Everything below updates live as beekeepers and officers make changes.</p>
            <div className="hero-actions">
              <button className="primary-button" onClick={() => go('requests')}><ClipboardCheck size={17} /> Review queue</button>
              <button className="ghost-button" onClick={() => go('notices')}><Megaphone size={17} /> Post a notice</button>
            </div>
          </div>
        </div>

        <section className="panel notice-board">
          <PanelHeader title="Notice board" subtitle="Important notices from your offices" action="Open" onAction={() => go('notices')} />
          <div className="notice-scroll">
            {(notices.data || []).length === 0
              ? <Empty>No notices yet. Post one for your keepers from the Notice board.</Empty>
              : (notices.data || []).map((row) => <NoticeCard key={row.id} row={row} compact />)}
          </div>
        </section>
      </section>

      <div className="signal-strip">
        <div>
          <span className={`signal-icon ${intact ? 'green' : 'gold'}`}>{intact ? <ShieldCheck size={18} /> : <AlertTriangle size={18} />}</span>
          <div><strong>{intact ? 'Blockchain verified' : 'Blockchain integrity problem'}</strong><span>{`Block #${chain.height} · ${num(chain.events)} transactions signed by ${chain.validator.id}`}</span></div>
        </div>
        <div className="strip-divider" />
        <div>
          <span className="signal-icon gold"><ClipboardCheck size={18} /></span>
          <div><strong>{`${overview.pendingOrganizations} registration(s), ${overview.pendingLabReviews} lab result(s)`}</strong><span>waiting for a decision in your jurisdiction</span></div>
        </div>
        <div className="strip-link" onClick={() => go('chain')}>Open blockchain <ArrowUpRight size={15} /></div>
      </div>

      <section className="metric-grid">
        <Metric label="Organizations" value={num(organizations.approved)} note={`${organizations.total} registered`} icon={Store} tone="gold" />
        <Metric label="Honey recorded" value={kg(overview.honeyKg)} note={`${overview.batches} batches`} icon={Boxes} tone="green" />
        <Metric label="Bottle QR codes" value={num(overview.bottles)} note="on the chain" icon={QrCode} tone="blue" />
        {showIncome
          ? <Metric label="Income this month" value={inr(overview.monthIncomeInr)} note="all companies" icon={IndianRupee} tone="rose" />
          : <Metric label="Pending reviews" value={overview.pendingOrganizations + overview.pendingLabReviews} note="need a decision" icon={ClipboardCheck} tone="rose" alert />}
      </section>

      <div className="dashboard-grid">
        <section className="panel">
          <PanelHeader title="Honey produced" subtitle="Kilograms harvested per month, from batches on the chain" />
          <Bars series={series} valueKey="honeyKg" format={(value) => `${Math.round(value)}`} tone="gold" />
        </section>
        <section className="panel attention-panel">
          <PanelHeader title="Needs attention" subtitle="Open items in your jurisdiction" />
          <div className="attention-list">
            <Attention icon={ClipboardCheck} title={`${overview.pendingOrganizations} organisation registration(s)`} text="Decide who joins the KVIC monitoring chain" action="Review" onClick={() => go('requests')} />
            <Attention icon={FlaskConical} title={`${overview.pendingLabReviews} lab result(s)`} text="Shared by beekeepers for verification" action="Review" onClick={() => go('requests', { tab: 'labs' })} />
            {organizations.suspended + organizations.rejected > 0 && (
              <Attention icon={AlertTriangle} title={`${organizations.suspended} suspended, ${organizations.rejected} rejected`} text="Organisations outside the chain" action="View" onClick={() => go('organizations', { status: 'SUSPENDED' })} />
            )}
            {user.role === 'KVIC_HEAD' && (
              <Attention icon={UserCog} title="Officer supervision" text={(overview.officers || []).map((row) => `${row.active}/${row.total} ${row.role === 'STATE_OFFICER' ? 'state' : 'regional'}`).join(' · ') || 'No officers yet'} action="Open" onClick={() => go('officers')} />
            )}
          </div>
        </section>
      </div>

      {analytics.data && (
        <section className="panel table-panel">
          <PanelHeader
            title={analytics.data.level === 'state' ? 'States' : 'Regions'}
            subtitle={analytics.data.level === 'state' ? 'Production, verification and officer performance by state' : 'Regional production and how quickly regional officers work through their queues'}
          />
          <div className="table-scroll">
            <table className="dtable perf-table">
              <thead><tr>
                <th>{analytics.data.level === 'state' ? 'State' : 'Region'}</th><th className="num">Orgs</th><th className="num">Pending</th>
                <th className="num">Honey</th><th className="num">Bottles</th><th className="num">Labs verified</th>
                <th className="num">Avg org approval</th><th className="num">Avg lab review</th><th className="num">Income (month)</th><th>Officers</th>
              </tr></thead>
              <tbody>
                {analytics.data.rows.map((row) => (
                  <tr key={row.name}>
                    <td><strong>{row.name}</strong></td>
                    <td className="num">{row.approved} / {row.organizations}</td>
                    <td className="num">{row.pending + row.labsPending}</td>
                    <td className="num">{kg(row.honeyKg)}</td>
                    <td className="num">{num(row.bottles)}</td>
                    <td className="num">{row.labsVerified}</td>
                    <td className="num">{hours(row.avgApprovalHours)}</td>
                    <td className="num">{hours(row.avgLabHours)}</td>
                    <td className="num">{inr(row.monthIncomeInr)}</td>
                    <td>{row.officers.length === 0 ? <small>None assigned</small> : row.officers.map((officer) => <small key={officer.id}>{officer.name} · {officer.decisions} decisions{officer.active ? '' : ' · inactive'}</small>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {showIncome && (
        <section className="panel" style={{ marginTop: 14 }}>
          <PanelHeader title="Monthly income" subtitle="Total reported by companies in your jurisdiction" action="Full report" onAction={() => go('reports')} />
          <Bars series={series} valueKey="incomeInr" format={(value) => (value >= 1000 ? `${Math.round(value / 1000)}k` : `${value}`)} tone="green" />
        </section>
      )}

      <section className="panel table-panel">
        <PanelHeader title="Latest batches" subtitle="Newest harvests recorded on the shared chain" action="Open blockchain" onAction={() => go('chain', { tab: 'batches' })} />
        {overview.recentBatches.length === 0 ? <Empty>No batches recorded yet.</Empty> : (
          <div className="table-scroll">
            <table className="dtable">
              <thead><tr><th>Batch</th><th>Organisation</th><th>Honey</th><th className="num">Quantity</th><th>Harvested</th><th>Status</th><th /></tr></thead>
              <tbody>
                {overview.recentBatches.map((batch) => (
                  <tr key={batch.code} className="clickable" onClick={() => go('chain', { tab: 'batches', batchCode: batch.code })}>
                    <td><strong>{batch.code}</strong></td><td>{batch.orgName}</td><td>{batch.honeyType}</td>
                    <td className="num">{kg(batch.quantityKg)}</td><td>{fmtDate(batch.harvestDate)}</td>
                    <td><StatusPill status={batch.status} /></td><td><ChevronRight size={16} className="row-arrow" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

function Attention({ icon: Icon, title, text, action, onClick }) {
  return (
    <div className="attention-item">
      <span className="attention-icon"><Icon size={17} /></span>
      <div><strong>{title}</strong><span>{text}</span></div>
      <button onClick={onClick}>{action}<ChevronRight size={14} /></button>
    </div>
  )
}
