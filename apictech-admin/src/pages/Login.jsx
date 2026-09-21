import { useEffect, useState } from 'react'
import { api, session } from '../api'
import { LanguageToggle } from '../i18n'

// Demo credentials shown on the sign-in page for now (development only).
const ADMIN_ACCOUNTS = [
  { label: 'KVIC Head', detail: 'All states, officers, approvals and audit', username: 'kvic.head', password: 'kvic@12345' },
]

const STATE_PASSWORD = 'state@12345'
const stateUsername = (state) => (state === 'Tamil Nadu' ? 'state.tn' : `state.${state.toLowerCase().replace(/\s+/g, '-')}`)

const REGIONAL_PASSWORD = 'region@12345'
const regionalUsername = (region) => `region.${region.toLowerCase().replace(/\s+/g, '-')}`

const KEEPER_URL = `${window.location.protocol}//${window.location.hostname}:5173`

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [regions, setRegions] = useState({})

  useEffect(() => { api('/regions').then(setRegions).catch(() => {}) }, [])

  function pickRegion(event) {
    const region = event.target.value
    if (!region) return
    setUsername(regionalUsername(region))
    setPassword(REGIONAL_PASSWORD)
  }

  function pickState(event) {
    const state = event.target.value
    if (!state) return
    setUsername(stateUsername(state))
    setPassword(STATE_PASSWORD)
  }

  async function submit(event) {
    event.preventDefault()
    setError('')
    setBusy(true)

    try {
      const { token, user } = await api('/auth/login', { method: 'POST', body: { username, password } })

      if (user.role === 'BEEKEEPER') {
        setError(`Beekeeper accounts sign in to Honey Chain Keeper (${KEEPER_URL}), not the KVIC portal.`)
        return
      }

      session.save(token, user)
      onLogin(user)
    } catch (loginError) {
      setError(loginError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-lang"><LanguageToggle /></div>
      <form className="login-card" onSubmit={submit}>
        <div className="brand"><img className="brand-logo" src="/honeychain-logo.png" alt="" /><div><strong>Honey Chain</strong><span>Admin · KVIC Control Portal</span></div></div>
        <h1>Officer sign in</h1>
        <p>KVIC Head, State Officers and Regional Officers only.</p>
        <label className="field">Username<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoFocus required /></label>
        <label className="field">Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
        {error && <div className="form-error">{error}</div>}
        <button className="primary-button" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>

        <div className="demo-accounts">
          <p>Login details (demo, click to fill)</p>
          {ADMIN_ACCOUNTS.map((account) => (
            <button type="button" className="demo-chip" key={account.username} onClick={() => { setUsername(account.username); setPassword(account.password) }}>
              <b>{account.label}</b>
              <span className="cred">{account.username} / {account.password}</span>
              <small>{account.detail}</small>
            </button>
          ))}
          <div className="demo-chip regional-picker">
            <b>State Officer</b>
            <span className="cred">state.&lt;state&gt; / {STATE_PASSWORD}</span>
            <small>One login for every state. Choose one to fill it in.</small>
            <select defaultValue="" onChange={pickState} aria-label="Choose a state officer login">
              <option value="">Choose a state…</option>
              {Object.keys(regions).map((state) => <option key={state} value={state}>{state} · {stateUsername(state)}</option>)}
            </select>
          </div>
          <div className="demo-chip regional-picker">
            <b>Regional Officer</b>
            <span className="cred">region.&lt;location&gt; / {REGIONAL_PASSWORD}</span>
            <small>One login for every registration location. Choose one to fill it in.</small>
            <select defaultValue="" onChange={pickRegion} aria-label="Choose a regional officer login">
              <option value="">Choose a location…</option>
              {Object.entries(regions).map(([state, list]) => (
                <optgroup key={state} label={state}>
                  {list.map((region) => <option key={region} value={region}>{region} · {regionalUsername(region)}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="demo-note">
            <b>Honey Chain Keeper</b>
            <small>{`Beekeepers register at ${KEEPER_URL}. New registrations appear in the Regional Officer's review queue.`}</small>
          </div>
        </div>
      </form>
    </div>
  )
}
