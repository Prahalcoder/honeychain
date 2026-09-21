import { useEffect, useState } from 'react'
import { KeyRound, Plus, UserPlus } from 'lucide-react'

import { api, useLive } from '../api'
import { Empty, ErrorNote, LiveBadge, Modal, PageIntro, ROLE_LABELS, fmtDateTime, num } from '../ui'

// KVIC head: create, deactivate and supervise state and regional officers.
// State officers get a read-only view of the regional officers in their state.
export default function Officers({ user, go, notify }) {
  const officers = useLive('/admin/officers', { interval: 5000 })
  const [showCreate, setShowCreate] = useState(false)
  const [resetting, setResetting] = useState(null)
  const isHead = user.role === 'KVIC_HEAD'
  const rows = officers.data || []

  async function toggle(officer) {
    await api(`/admin/officers/${officer.id}`, { method: 'PATCH', body: { active: !officer.active } })
    notify(`${officer.name} ${officer.active ? 'deactivated' : 'activated'}`)
    officers.refresh()
  }

  return (
    <>
      <PageIntro
        eyebrow="Governance"
        title="Officers"
        copy={isHead ? 'Create state and regional officer logins, see their workload and switch access on or off.' : 'Regional officers working in your state.'}
        right={<div style={{ display: 'flex', gap: 14, alignItems: 'center' }}><LiveBadge updatedAt={officers.updatedAt} error={officers.error} />{isHead && <button className="primary-button" onClick={() => setShowCreate(true)}><UserPlus size={16} />Add officer</button>}</div>}
      />

      <section className="panel table-panel" style={{ marginTop: 0 }}>
        {rows.length === 0 ? <Empty>No officers yet.</Empty> : (
          <div className="table-scroll" style={{ marginTop: 0 }}>
            <table className="dtable">
              <thead><tr><th>Officer</th><th>Role</th><th>Jurisdiction</th><th>Access</th><th>Last sign-in</th><th className="num">Decisions</th><th className="num">Waiting</th><th /></tr></thead>
              <tbody>{rows.map((officer) => (
                <tr key={officer.id}>
                  <td><strong>{officer.name}</strong><small>{officer.username}</small></td>
                  <td>{ROLE_LABELS[officer.role]}</td>
                  <td>{officer.role === 'STATE_OFFICER' ? officer.state : `${officer.region}, ${officer.state}`}</td>
                  <td><em className={`status ${officer.active ? 'green' : 'red'}`}>{officer.active ? 'Active' : 'Deactivated'}</em></td>
                  <td>{officer.lastLoginAt ? fmtDateTime(officer.lastLoginAt) : 'Never'}</td>
                  <td className="num">{num(officer.decisions)}</td>
                  <td className="num">{officer.pendingOrganizations} orgs · {officer.pendingLabReviews} labs</td>
                  <td>
                    <div className="button-row" style={{ margin: 0 }}>
                      <button className="small-button" onClick={() => go('activity', { userId: officer.id })}>Activity</button>
                      {isHead && <>
                        <button className={`small-button ${officer.active ? 'danger' : 'approve'}`} onClick={() => toggle(officer).catch((error) => notify(error.message))}>{officer.active ? 'Deactivate' : 'Activate'}</button>
                        <button className="small-button" onClick={() => setResetting(officer)}><KeyRound size={12} />Reset</button>
                      </>}
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      {showCreate && <CreateOfficer onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); officers.refresh(); notify('Officer created') }} />}
      {resetting && <ResetPassword officer={resetting} onClose={() => setResetting(null)} onDone={() => { setResetting(null); notify('Password reset') }} />}
    </>
  )
}

function CreateOfficer({ onClose, onCreated }) {
  const [regions, setRegions] = useState({})
  const [form, setForm] = useState({ role: 'REGIONAL_OFFICER', name: '', username: '', password: '', state: '', region: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { api('/regions').then(setRegions).catch(() => {}) }, [])

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value, ...(field === 'state' ? { region: '' } : {}) }))
  const regional = form.role === 'REGIONAL_OFFICER'

  async function submit(event) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api('/admin/officers', { method: 'POST', body: form })
      onCreated()
    } catch (createError) {
      setError(createError.message)
      setBusy(false)
    }
  }

  return (
    <Modal title="Add an officer" eyebrow="New login" onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field">Role<select value={form.role} onChange={set('role')}><option value="REGIONAL_OFFICER">Regional officer</option><option value="STATE_OFFICER">State officer</option></select></label>
        <label className="field">Full name<input value={form.name} onChange={set('name')} required /></label>
        <div className="two-col">
          <label className="field">Username<input value={form.username} onChange={set('username')} required autoComplete="off" /></label>
          <label className="field">Temporary password<input type="text" value={form.password} onChange={set('password')} minLength={8} required autoComplete="off" /></label>
        </div>
        <div className="two-col">
          <label className="field">State<select value={form.state} onChange={set('state')} required><option value="">Select…</option>{Object.keys(regions).map((state) => <option key={state}>{state}</option>)}</select></label>
          {regional && <label className="field">Region<select value={form.region} onChange={set('region')} required><option value="">Select…</option>{(regions[form.state] || []).map((region) => <option key={region}>{region}</option>)}</select></label>}
        </div>
        <ErrorNote>{error}</ErrorNote>
        <div className="button-row"><button className="primary-button" disabled={busy}><Plus size={15} />{busy ? 'Creating…' : 'Create officer'}</button><button type="button" className="secondary-button" onClick={onClose}>Cancel</button></div>
      </form>
    </Modal>
  )
}

function ResetPassword({ officer, onClose, onDone }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    try {
      await api(`/admin/officers/${officer.id}/reset-password`, { method: 'POST', body: { password } })
      onDone()
    } catch (resetError) { setError(resetError.message) }
  }

  return (
    <Modal title={`Reset password for ${officer.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field">New temporary password<input type="text" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required autoComplete="off" /></label>
        <ErrorNote>{error}</ErrorNote>
        <div className="button-row"><button className="primary-button">Reset password</button><button type="button" className="secondary-button" onClick={onClose}>Cancel</button></div>
      </form>
    </Modal>
  )
}
