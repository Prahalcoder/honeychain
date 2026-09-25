import { useState } from 'react'
import { KeyRound, Smartphone } from 'lucide-react'

import { apiRequest } from '../lib/api'

const inputClass = 'w-full rounded-xl border border-[#c6e2e0] bg-[#f7fbfb] px-4 py-3 outline-none transition focus:border-[#F97360] focus:ring-4 focus:ring-[#F97360]/15'

// Forgot password: sign in with a one-time code sent to the mobile number or e-mail on the account (any beekeeper,
// firm, society, company or wholesaler login), optionally setting a new password at the same time.
export default function OtpSignIn({ onSignedIn, onBack }) {
  const [identifier, setIdentifier] = useState('')
  const [sent, setSent] = useState(null)
  const [otp, setOtp] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function request(event) {
    event?.preventDefault()
    setError(''); setBusy(true)
    try {
      setSent(await apiRequest('/auth/otp/request', { method: 'POST', body: JSON.stringify({ identifier }) }))
      setOtp('')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  async function verify(event) {
    event.preventDefault()
    setError(''); setBusy(true)
    try {
      const { token, user } = await apiRequest('/auth/otp/verify', { method: 'POST', body: JSON.stringify({ identifier, otp, newPassword: newPassword || undefined }) })
      onSignedIn(token, user)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <div className="rounded-3xl border border-[#c6e2e0] bg-white p-7 shadow-[0_20px_60px_rgba(21,49,55,0.08)]">
      <p className="flex items-center gap-2 text-lg font-black"><KeyRound size={20} /> Sign in with an OTP</p>
      <p className="mt-1 text-sm text-gray-500">Forgot your password? Enter the mobile number or e-mail registered on your account. We send a 6-digit code valid for 5 minutes.</p>

      {!sent ? (
        <form onSubmit={request} className="mt-5">
          <label className="mb-2 block text-sm font-semibold">Registered mobile number or e-mail</label>
          <div className="relative">
            <Smartphone size={18} className="absolute left-3 top-3.5 text-gray-400" />
            <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="9876543210 or you@example.com" className={`${inputClass} pl-10`} required />
          </div>
          {error && <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</div>}
          <button type="submit" disabled={busy || identifier.trim().length < 5} className="mt-5 w-full rounded-xl bg-[#0F766E] py-3 font-bold text-white hover:bg-[#115e59] disabled:opacity-60">
            {busy ? 'Sending…' : 'Send OTP'}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="mt-5">
          <p className="rounded-xl bg-[#eff7f6] p-3 text-sm text-[#0F766E]">
            If an account uses it, a code was sent by {sent.channel === 'EMAIL' ? 'e-mail' : 'SMS'} to <b>{sent.to}</b>.
          </p>
          {sent.demoOtp && (
            <p className="mt-2 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">
              Demo mode (no SMS / e-mail service connected yet): your OTP is <b className="font-mono text-base">{sent.demoOtp}</b>
            </p>
          )}
          <label className="mb-2 mt-4 block text-sm font-semibold">6-digit OTP</label>
          <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" className={`${inputClass} font-mono text-lg tracking-[0.4em]`} required />
          <label className="mb-2 mt-4 block text-sm font-semibold">New password <span className="font-normal text-gray-400">(optional — set one now)</span></label>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" placeholder="At least 8 characters" minLength={8} className={inputClass} />
          {error && <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</div>}
          <button type="submit" disabled={busy || otp.length !== 6} className="mt-5 w-full rounded-xl bg-[#0F766E] py-3 font-bold text-white hover:bg-[#115e59] disabled:opacity-60">
            {busy ? 'Checking…' : 'Sign in'}
          </button>
          <button type="button" onClick={() => request()} disabled={busy} className="mt-3 w-full text-sm font-bold text-[#168481] hover:underline">Send a new code</button>
        </form>
      )}
      <button type="button" onClick={onBack} className="mt-4 w-full text-sm font-bold text-gray-500 hover:underline">Back to password sign-in</button>
    </div>
  )
}
