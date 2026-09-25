import { useMemo, useState } from 'react'
import { MapPin, ShieldAlert, Smartphone } from 'lucide-react'

import { api, useLive } from '../api'
import { Empty, ErrorNote, LiveBadge, Modal, PageIntro, StatusPill, fmtDateTime } from '../ui'

// Jars whose QR code looks copied onto fake jars (backend services/qrGuard.js): every consumer scan on the public
// verify page is logged, and a jar is flagged when the same code turns up too far apart too quickly, in many
// far-apart places, on too many phones, or when a buyer reports it. The officer confirms (the code is marked
// copied, sealed on the chain, and every later scan warns the buyer) or clears it (an innocent explanation).

const FILTERS = [['OPEN', 'Open'], ['CONFIRMED', 'Confirmed copies'], ['CLEARED', 'Cleared'], ['ALL', 'All']]

const REASONS = {
  IMPOSSIBLE_TRAVEL: 'Impossible travel',
  MANY_PLACES: 'Many far-apart places',
  TOO_MANY_PHONES: 'Too many phones',
  CONSUMER_REPORT: 'Buyer report',
}

function Evidence({ alert }) {
  const d = alert.detail || {}
  if (alert.reason === 'IMPOSSIBLE_TRAVEL') {
    return <p className="note">Scanned {d.distanceKm} km apart within {d.minutesApart} min (about {Number(d.impliedSpeedKmh).toLocaleString('en-IN')} km/h). First at {d.first?.latitude}, {d.first?.longitude} ({fmtDateTime(d.first?.at)}), then at {d.second?.latitude}, {d.second?.longitude} ({fmtDateTime(d.second?.at)}).</p>
  }
  if (alert.reason === 'MANY_PLACES') {
    return <p className="note">{(d.places || []).length} places at least 100 km apart: {(d.places || []).map((place) => `${place.latitude}, ${place.longitude} (${place.phones} phone${place.phones === 1 ? '' : 's'})`).join(' · ')}</p>
  }
  if (alert.reason === 'TOO_MANY_PHONES') return <p className="note">{d.phones} different phones in {d.scans} scans. One jar is normally opened by one household.</p>
  if (alert.reason === 'CONSUMER_REPORT') {
    return <div className="note">{(d.reports || []).map((report, index) => <p key={index}>“{report.text}” <small>({fmtDateTime(report.at)})</small></p>)}</div>
  }
  return null
}

export default function JarAlerts({ notify, refreshOverview }) {
  const [status, setStatus] = useState('OPEN')
  const [deciding, setDeciding] = useState(null)
  const list = useLive(`/admin/jar-alerts?status=${status}`, { interval: 8000 })

  // One card per jar, with every reason it was flagged for.
  const jars = useMemo(() => {
    const byPack = new Map()
    for (const alert of list.data || []) {
      const key = `${alert.packId}|${alert.status}`
      if (!byPack.has(key)) byPack.set(key, { ...alert, alerts: [] })
      byPack.get(key).alerts.push(alert)
    }
    return [...byPack.values()]
  }, [list.data])

  return (
    <>
      <PageIntro
        eyebrow="Anti-counterfeit"
        title="Copied QR codes"
        copy="Every consumer scan of a jar is logged. A code scanned too far apart too quickly, in many far-apart places, on too many phones, or reported by a buyer is flagged here for you to confirm or clear."
        right={<LiveBadge updatedAt={list.updatedAt} error={list.error} />}
      />

      <div className="toolbar">
        <div className="chips">{FILTERS.map(([value, label]) => <button key={value} className={`chip ${status === value ? 'active' : ''}`} onClick={() => setStatus(value)}>{label}</button>)}</div>
      </div>

      <section className="panel">
        {jars.length === 0 ? <Empty>{status === 'OPEN' ? 'No jars are flagged in your jurisdiction right now.' : 'Nothing here.'}</Empty> : (
          <div className="alert-list">
            {jars.map((jar) => (
              <article key={`${jar.packId}-${jar.status}`} className={`jar-alert ${jar.status === 'OPEN' ? 'open' : ''}`}>
                <div className="jar-alert-head">
                  <ShieldAlert size={20} />
                  <div>
                    <strong>{jar.packId}</strong>
                    <span>{jar.product} · batch {jar.batchCode} · {jar.org.name} ({jar.org.region}, {jar.org.state})</span>
                  </div>
                  <StatusPill status={jar.status} />
                </div>
                <div className="jar-alert-stats">
                  <span><Smartphone size={14} /> {jar.scanStats?.scans ?? 0} scans on {jar.scanStats?.phones ?? 0} phones</span>
                  {jar.scanStats?.firstScannedAt && <span><MapPin size={14} /> first scan {fmtDateTime(jar.scanStats.firstScannedAt)}</span>}
                  <span>flagged {fmtDateTime(jar.createdAt)}</span>
                </div>
                {jar.alerts.map((alert) => (
                  <div key={alert.id} className="jar-alert-reason">
                    <b>{REASONS[alert.reason] || alert.label}</b>
                    <Evidence alert={alert} />
                  </div>
                ))}
                {jar.status !== 'OPEN' && jar.resolvedBy && <p className="note">{jar.status === 'CONFIRMED' ? 'Confirmed' : 'Cleared'} by {jar.resolvedBy} on {fmtDateTime(jar.resolvedAt)}: “{jar.resolutionNote}”</p>}
                {jar.status === 'OPEN' && (
                  <div className="button-row">
                    <button className="small-button danger" onClick={() => setDeciding({ jar, decision: 'CONFIRM' })}>Confirm copied code</button>
                    <button className="small-button approve" onClick={() => setDeciding({ jar, decision: 'CLEAR' })}>Clear (genuine)</button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {deciding && (
        <DecideModal
          {...deciding}
          onClose={() => setDeciding(null)}
          onDone={(message) => { setDeciding(null); notify(message); list.refresh(); refreshOverview() }}
        />
      )}
    </>
  )
}

function DecideModal({ jar, decision, onClose, onDone }) {
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const confirm = decision === 'CONFIRM'

  async function submit(event) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      await api(`/admin/jar-alerts/${encodeURIComponent(jar.packId)}/decision`, { method: 'POST', body: { decision, note } })
      onDone(confirm ? `${jar.packId} marked as a copied code` : `${jar.packId} cleared`)
    } catch (submitError) { setError(submitError.message) } finally { setBusy(false) }
  }

  return (
    <Modal title={confirm ? 'Confirm this QR code was copied?' : 'Clear this jar?'} eyebrow={jar.packId} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="note">
          {confirm
            ? 'Every future scan of this code will tell the buyer it is on a fake jar, and the decision is sealed on the Honey Chain ledger. The genuine keeper is not penalised.'
            : 'The alert closes. The same alert only comes back if new evidence appears (a new impossible trip, more places, or another full set of phones).'}
        </p>
        <label className="field">Note (what you checked){' '}<textarea value={note} onChange={(event) => setNote(event.target.value)} required minLength={5} placeholder={confirm ? 'e.g. seller in Delhi has no stock from this keeper' : 'e.g. gift jar carried by train, confirmed with the buyer'} /></label>
        <ErrorNote>{error}</ErrorNote>
        <div className="button-row">
          <button className={`primary-button ${confirm ? 'danger-fill' : ''}`} disabled={busy}>{busy ? 'Saving…' : confirm ? 'Confirm copied code' : 'Clear alert'}</button>
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  )
}
