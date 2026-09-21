import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, User, Eye, EyeOff } from 'lucide-react'
import { apiRequest } from '../lib/api'
import { resetSummary } from '../lib/store'
import { LanguageToggle } from '../i18n'

const ORGANIZATION_TYPES = [
  { value: 'KVIC_BEEKEEPER', label: 'Beekeeper registered with KVIC (Honey Mission)' },
  { value: 'ORG_BEEKEEPER', label: 'Beekeeper registered through another organisation (SHG / FPO / NGO)' },
  { value: 'LOCAL_STARTUP', label: 'Local honey startup / food business' },
]

const inputClass = 'w-full rounded-xl border border-[#c6e2e0] bg-[#f7fbfb] px-4 py-3 outline-none focus:border-[#F97360]'

export default function Login() {
  const navigate = useNavigate()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [form, setForm] = useState({
    name: '',
    organizationName: '',
    organizationType: 'KVIC_BEEKEEPER',
    registrationBody: '',
    registrationId: '',
    fssaiLicense: '',
    gstin: '',
    state: '',
    region: '',
    phone: '',
    email: '',
  })
  const [regions, setRegions] = useState({})
  const [isRegistering, setIsRegistering] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    apiRequest('/regions').then(setRegions).catch(() => {})
  }, [])

  const setField = (field) => (event) => {
    const value = field === 'gstin' ? event.target.value.toUpperCase() : event.target.value
    setForm((current) => ({ ...current, [field]: value, ...(field === 'state' ? { region: '' } : {}) }))
  }

  const isKvic = form.organizationType === 'KVIC_BEEKEEPER'

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const { token, user } = await apiRequest(isRegistering ? '/auth/register' : '/auth/login', {
        method: 'POST',
        body: JSON.stringify(isRegistering
          ? { ...form, username, password }
          : { username, password }),
      })

      if (user.role !== 'BEEKEEPER') {
        setError('Officer accounts sign in to the KVIC control room, not the beekeeper app.')
        return
      }

      resetSummary()
      localStorage.setItem('apictech_token', token)
      localStorage.setItem('apictech_user', JSON.stringify(user))
      navigate('/dashboard')
    } catch (loginError) {
      setError(loginError.message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="app-shell flex min-h-screen">

      <div className="fixed right-5 top-5 z-50"><LanguageToggle /></div>

      <div className="relative hidden w-[52%] overflow-hidden bg-[#0F766E] px-16 lg:flex lg:items-center">
        <div className="absolute -right-32 -top-24 h-96 w-96 rounded-full border-40 border-[#F97360]/10" />
        <div className="absolute -bottom-48 -left-20 h-96 w-96 rounded-full border-60 border-[#e36e4b]/10" />
        <div className="relative max-w-lg text-left text-white">

          <img
            src="/apictech-logo.png"
            alt="Honey Chain"
            className="h-24 w-24 rounded-3xl object-cover shadow-[0_0_0_8px_rgba(247,84,59,0.12)]"
          />

          <p className="mt-12 text-xs font-bold uppercase tracking-[0.24em] text-[#F97360]">
            Intelligent apiary operations
          </p>
          <h1 className="mt-4 text-5xl font-black leading-[1.05]">
            Honey Chain Keeper
          </h1>

          <p className="mt-5 max-w-md text-lg leading-relaxed text-[#bac4c5]">
            From hive health to honey traceability, keep every decision grounded in the field.
          </p>

          <div className="mt-14 flex gap-8 border-t border-white/10 pt-6 text-sm">
            <div><p className="font-black text-[#F97360]">24/7</p><p className="mt-1 text-[#8c9184]">Field visibility</p></div>
            <div><p className="font-black text-[#F97360]">100%</p><p className="mt-1 text-[#8c9184]">Batch traceability</p></div>
          </div>

        </div>
      </div>

      <div className="flex w-full items-center justify-center p-6 lg:w-[48%]">

        <div className={`w-full ${isRegistering ? 'max-w-xl' : 'max-w-md'}`}>

          <div className="mb-8 text-center lg:text-left">
            <img
              src="/apictech-logo.png"
              alt="Honey Chain"
              className="mx-auto mb-4 h-20 w-20 rounded-full lg:hidden"
            />

            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#199995]">
              {isRegistering ? 'Join the KVIC monitoring chain' : 'Secure workspace'}
            </p>
            <h2 className="mt-3 text-3xl font-black">
              {isRegistering ? 'Register your organisation.' : 'Welcome back.'}
            </h2>

            <p className="mt-2 text-gray-500">
              {isRegistering
                ? 'Your regional KVIC officer reviews these details before your honey can be recorded on the chain.'
                : 'Sign in to your beekeeper dashboard.'}
            </p>
          </div>

          <form
            onSubmit={handleLogin}
            className="rounded-3xl border border-[#c6e2e0] bg-white p-7 shadow-[0_20px_60px_rgba(21,49,55,0.08)]"
          >

            {isRegistering && <>
              <div className="mb-5">
                <label className="mb-2 block text-sm font-semibold">Full Name</label>
                <input value={form.name} onChange={setField('name')} placeholder="Your full name" className={inputClass} required />
              </div>
              <div className="mb-5">
                <label className="mb-2 block text-sm font-semibold">Organisation / Farm Name</label>
                <input value={form.organizationName} onChange={setField('organizationName')} placeholder="Name as registered" className={inputClass} required />
              </div>
              <div className="mb-5">
                <label className="mb-2 block text-sm font-semibold">How are you registered?</label>
                <select value={form.organizationType} onChange={setField('organizationType')} className={inputClass}>
                  {ORGANIZATION_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
              </div>
              <div className="mb-5 grid gap-5 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-semibold">{isKvic ? 'KVIC Madhukranti ID' : 'Registration number'}</label>
                  <input value={form.registrationId} onChange={setField('registrationId')} placeholder={isKvic ? 'e.g. MK-TN-000123' : 'Issued by your organisation'} className={inputClass} required />
                </div>
                {!isKvic && (
                  <div>
                    <label className="mb-2 block text-sm font-semibold">Issuing organisation</label>
                    <input value={form.registrationBody} onChange={setField('registrationBody')} placeholder="e.g. Madurai Beekeepers FPO" className={inputClass} required />
                  </div>
                )}
              </div>
              <div className="mb-5 grid gap-5 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-semibold">FSSAI licence number</label>
                  <input value={form.fssaiLicense} onChange={setField('fssaiLicense')} inputMode="numeric" maxLength={14} pattern="\d{14}" title="14 digits" placeholder="14-digit food safety number" className={inputClass} required />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold">GSTIN <span className="font-normal text-gray-400">(optional)</span></label>
                  <input value={form.gstin} onChange={setField('gstin')} maxLength={15} placeholder="If GST registered" className={inputClass} />
                </div>
              </div>
              <div className="mb-5 grid gap-5 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-semibold">State</label>
                  <select value={form.state} onChange={setField('state')} className={inputClass} required>
                    <option value="">Select state</option>
                    {Object.keys(regions).map((state) => <option key={state}>{state}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold">KVIC region</label>
                  <select value={form.region} onChange={setField('region')} className={inputClass} required disabled={!form.state}>
                    <option value="">Select region</option>
                    {(regions[form.state] || []).map((region) => <option key={region}>{region}</option>)}
                  </select>
                </div>
              </div>
              <div className="mb-5 grid gap-5 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-semibold">Phone</label>
                  <input value={form.phone} onChange={setField('phone')} placeholder="+91 98765 43210" className={inputClass} />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold">Business Email</label>
                  <input type="email" value={form.email} onChange={setField('email')} placeholder="business@example.com" className={inputClass} />
                </div>
              </div>
            </>}

            <div className="mb-5">
              <label className="mb-2 block text-sm font-semibold">
                Username
              </label>

              <div className="relative">
                <User
                  size={18}
                  className="absolute left-3 top-3.5 text-gray-400"
                />

                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter username"
                  className="w-full rounded-xl border border-[#c6e2e0] bg-[#f7fbfb] py-3 pl-10 pr-4 outline-none transition focus:border-[#F97360] focus:ring-4 focus:ring-[#F97360]/15"
                  required
                />
              </div>
            </div>

            <div className="mb-5">
              <label className="mb-2 block text-sm font-semibold">
                Password
              </label>

              <div className="relative">
                <Lock
                  size={18}
                  className="absolute left-3 top-3.5 text-gray-400"
                />

                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isRegistering ? 'At least 8 characters' : 'Enter password'}
                  className="w-full rounded-xl border border-[#c6e2e0] bg-[#f7fbfb] py-3 pl-10 pr-12 outline-none transition focus:border-[#F97360] focus:ring-4 focus:ring-[#F97360]/15"
                  minLength={isRegistering ? 8 : undefined}
                  required
                />

                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3.5 text-gray-400"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-xl bg-[#0F766E] py-3 font-bold text-white transition hover:bg-[#115e59] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? 'Please wait...' : isRegistering ? 'Submit for approval' : 'Sign In'}
            </button>

            <button type="button" onClick={() => { setIsRegistering(!isRegistering); setError('') }} className="mt-4 w-full text-sm font-bold text-[#168481] hover:underline">
              {isRegistering ? 'Already registered? Sign in' : 'Register a new organisation'}
            </button>

            {!isRegistering && (
              <div className="mt-6 rounded-xl border border-[#d4e9e8] bg-[#eff7f6] p-4 text-sm">
                <p className="font-bold">Login details <span className="font-normal text-gray-400">(demo)</span></p>

                <p className="mt-2 text-xs text-gray-500">New here? Register your organisation above. A regional officer approves it before you can start.</p>

                <p className="mt-4 text-xs font-bold uppercase tracking-wide text-gray-400">KVIC officers use Honey Chain Admin ({window.location.hostname}:5174)</p>
                <ul className="mt-2 space-y-1 font-mono text-xs text-gray-600">
                  <li><span className="font-sans font-semibold">KVIC Head</span> kvic.head / kvic@12345</li>
                  <li><span className="font-sans font-semibold">State Officer</span> state.tn / state@12345</li>
                  <li><span className="font-sans font-semibold">Regional Officer</span> region.madurai / region@12345</li>
                </ul>
              </div>
            )}

          </form>

          <p className="mt-6 text-center text-xs text-gray-400">
            Honey Chain Keeper • Smart Beekeeping Platform
          </p>

        </div>
      </div>
    </div>
  )
}
