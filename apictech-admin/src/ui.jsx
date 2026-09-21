import { useEffect, useState } from 'react'
import { ChevronRight, X } from 'lucide-react'

export const ROLE_LABELS = {
  KVIC_HEAD: 'KVIC head',
  STATE_OFFICER: 'State officer',
  REGIONAL_OFFICER: 'Regional officer',
}

export const ORG_TYPE_LABELS = {
  KVIC_BEEKEEPER: 'KVIC beekeeper',
  ORG_BEEKEEPER: 'Beekeeper via organisation',
  LOCAL_STARTUP: 'Local startup',
}

export const STATUS_LABELS = {
  PENDING_APPROVAL: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  SUSPENDED: 'Suspended',
  CLOSURE_PENDING: 'Closing',
  CLOSED: 'Closed',
  SCHEDULED: 'Scheduled',
  COMPLETED: 'Reported',
  CANCELLED: 'Cancelled',
  PENDING: 'Pending',
  VERIFIED: 'Verified',
  HARVESTED: 'Harvested',
  LAB_TESTED: 'Lab tested',
  LAB_REVIEW: 'Lab review',
  IN_TRANSIT: 'In transit',
  CREATED: 'Created',
}

const STATUS_TONES = {
  APPROVED: 'green', VERIFIED: 'green', LAB_TESTED: 'green', CREATED: 'green',
  PENDING_APPROVAL: 'amber', PENDING: 'amber', HARVESTED: 'amber', LAB_REVIEW: 'amber',
  REJECTED: 'red', SUSPENDED: 'red', CLOSED: 'red', CLOSURE_PENDING: 'amber',
  IN_TRANSIT: 'blue', SCHEDULED: 'blue', COMPLETED: 'green', CANCELLED: 'red',
}

// SQLite CURRENT_TIMESTAMP values are UTC without a zone marker.
export function parseTs(value) {
  if (!value) return null
  const text = String(value)
  return new Date(/^\d{4}-\d{2}-\d{2} \d/.test(text) ? `${text.replace(' ', 'T')}Z` : text)
}

export function fmtDate(value) {
  const date = parseTs(value)
  if (!date || Number.isNaN(date.getTime())) return value || '—'
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function fmtDateTime(value) {
  const date = parseTs(value)
  if (!date || Number.isNaN(date.getTime())) return value || '—'
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
export const inr = (value) => rupees.format(value || 0)
export const kg = (value) => `${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })} kg`
export const num = (value) => Number(value || 0).toLocaleString('en-IN')
export const shortHash = (value, size = 10) => (value ? `${value.slice(0, size)}…${value.slice(-6)}` : '—')

export function monthLabel(month) {
  const [year, monthIndex] = month.split('-').map(Number)
  return new Date(year, monthIndex - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}

const monthShort = (month) => monthLabel(month).split(' ')[0]

export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'
}

export function jurisdictionLabel(user) {
  if (user.role === 'KVIC_HEAD') return 'National programme'
  if (user.role === 'STATE_OFFICER') return user.state
  return `${user.region}, ${user.state}`
}

export function StatusPill({ status }) {
  return <em className={`status ${STATUS_TONES[status] || 'blue'}`}>{STATUS_LABELS[status] || status}</em>
}

export function Metric({ label, value, note, icon: Icon, tone = 'green', alert }) {
  return (
    <div className="metric">
      <div className={`metric-icon ${tone}`}><Icon size={19} /></div>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {note && <div className={alert ? 'metric-change alert' : 'metric-change'}>{note}</div>}
    </div>
  )
}

export function PanelHeader({ title, subtitle, action, onAction }) {
  return (
    <div className="panel-header">
      <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
      {action && <button className="text-button" onClick={onAction}>{action}<ChevronRight size={15} /></button>}
    </div>
  )
}

export function PageIntro({ eyebrow, title, copy, right }) {
  return (
    <div className="page-heading compact">
      <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{copy && <p className="subheading">{copy}</p>}</div>
      {right}
    </div>
  )
}

export function Modal({ title, eyebrow, onClose, wide, children }) {
  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} onClick={(event) => event.stopPropagation()}>
        <button className="modal-close icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 className="modal-title">{title}</h2>
        {children}
      </div>
    </div>
  )
}

export function LiveBadge({ updatedAt, error }) {
  const [, tick] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => tick((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const seconds = updatedAt ? Math.max(0, Math.round((Date.now() - updatedAt.getTime()) / 1000)) : null

  if (error) return <span className="live-badge offline"><i />Offline · {error}</span>
  return <span className="live-badge"><i />{seconds === null ? 'Connecting…' : `Live · updated ${seconds}s ago`}</span>
}

export function Empty({ children }) {
  return <div className="empty-state">{children}</div>
}

export function ErrorNote({ children }) {
  return children ? <div className="form-error">{children}</div> : null
}

export function Bars({ series, valueKey, format, tone = 'green' }) {
  const max = Math.max(1, ...series.map((point) => point[valueKey] || 0))

  return (
    <div className="mini-bars">
      {series.map((point) => (
        <div className="mini-bar" key={point.month} title={`${monthLabel(point.month)}: ${format(point[valueKey] || 0)}`}>
          <span className="mini-bar-value">{format(point[valueKey] || 0)}</span>
          <div className="mini-bar-track"><div className={`mini-bar-fill ${tone}`} style={{ height: `${Math.max(3, ((point[valueKey] || 0) / max) * 100)}%` }} /></div>
          <span className="mini-bar-label">{monthShort(point.month)}</span>
        </div>
      ))}
    </div>
  )
}

export function downloadCsv(filename, rows) {
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const csv = rows.map((row) => row.map(escape).join(',')).join('\n')
  const link = document.createElement('a')
  link.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`
  link.download = filename
  link.click()
}
