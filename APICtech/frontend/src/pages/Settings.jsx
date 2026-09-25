import { useEffect, useState } from 'react'
import {
  User,
  Home,
  Building2,
  Radio,
  Shield,
  KeyRound,
  Save,
  Power,
  IndianRupee,
  FileText,
} from 'lucide-react'

import MainLayout from '../layouts/MainLayout'
import { apiRequest } from '../lib/api'
import { refreshSummary, useSummary } from '../lib/store'
import RegistrationDetails from '../components/registration/RegistrationDetails'
import PricesAndBills from './PricesBills'

const tabs = [
  {
    id: 'profile',
    name: 'Profile',
    icon: User,
  },
  {
    id: 'organisation',
    name: 'Organisation & address',
    icon: Building2,
  },
  {
    id: 'registration',
    name: 'Registration & documents',
    icon: FileText,
  },
  {
    id: 'business',
    name: 'Prices, bills & profit',
    icon: IndianRupee,
  },
  {
    id: 'iot',
    name: 'IoT Devices',
    icon: Radio,
  },
  {
    id: 'security',
    name: 'Security',
    icon: Shield,
  },
  {
    id: 'closure',
    name: 'Close organisation',
    icon: Power,
  },
]

export default function Settings() {
  const [active, setActive] = useState('profile')
  const [settings, setSettings] = useState({
    email: '',
    phone: '',
    farmName: '',
    farmLocation: '',
    businessName: '',
    gstin: '',
    businessAddress: '',
    contactEmail: '',
    addressLine: '',
    locality: '',
    district: '',
    pincode: '',
    upiId: '',
  })
  const [organization, setOrganization] = useState(null)
  const [offices, setOffices] = useState(null)
  const [profile, setProfile] = useState({ name: '', username: '' })
  const [status, setStatus] = useState('')

  useEffect(() => {
    Promise.all([apiRequest('/auth/settings'), apiRequest('/auth/me')])
      .then(([{ settings: savedSettings, organization: org, offices: kvicOffices }, { user }]) => {
        if (savedSettings) setSettings((current) => ({ ...current, ...savedSettings }))
        if (org) {
          setOrganization(org)
          setSettings((current) => ({ ...current, addressLine: org.addressLine, locality: org.locality, district: org.district, pincode: org.pincode, upiId: org.upiId }))
        }
        if (kvicOffices) setOffices(kvicOffices)
        if (user) setProfile({ name: user.name, username: user.username })
      })
      .catch(() => setStatus('Unable to load saved settings'))
  }, [])

  const updateField = (field, value) => {
    setSettings((current) => ({ ...current, [field]: value }))
  }

  const updateProfile = (field, value) => {
    setProfile((current) => ({ ...current, [field]: value }))
  }

  const saveSettings = async () => {
    setStatus('')

    try {
      await apiRequest('/auth/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      })
      setStatus('Saved just now')
      setOrganization((current) => (current ? { ...current, addressSample: false, addressLine: settings.addressLine, locality: settings.locality, district: settings.district, pincode: settings.pincode, upiId: settings.upiId } : current))
    } catch (saveError) {
      setStatus(saveError.message)
    }
  }

  return (
    <MainLayout title="Settings">

      <div>
        <h1 className="text-2xl font-black">
          Settings
        </h1>

        <p className="mt-1 text-sm text-gray-500">
          Manage your Honey Chain profile, farm and integrations.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">

        <div className="rounded-2xl border border-[#c0dfdd] bg-white p-3">

          {tabs.map((tab) => {

            const Icon = tab.icon

            return (
              <button
                key={tab.id}
                onClick={() => setActive(tab.id)}
                className={`mb-1 flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold ${
                  active === tab.id
                    ? 'bg-[#F97360]'
                    : 'text-gray-600 hover:bg-[#f4fbfb]'
                }`}
              >
                <Icon size={18} />
                {tab.name}
              </button>
            )
          })}

        </div>

        <div className="rounded-2xl border border-[#c0dfdd] bg-white p-6">

          {active === 'profile' && <Profile profile={profile} settings={settings} updateProfile={updateProfile} updateField={updateField} saveSettings={saveSettings} />}
          {active === 'organisation' && <Organisation organization={organization} offices={offices} settings={settings} updateField={updateField} saveSettings={saveSettings} />}
          {active === 'registration' && <RegistrationDetails />}
          {active === 'business' && <PricesAndBills />}
          {active === 'iot' && <IoT />}
          {active === 'security' && <Security />}
          {active === 'closure' && <Closure />}

          {status && <p className="mt-4 text-xs font-semibold text-[#777569]">{status}</p>}
        </div>

      </div>

    </MainLayout>
  )
}

function Profile({ profile, settings, updateProfile, updateField, saveSettings }) {
  const saveProfile = async () => {
    try {
      const result = await apiRequest('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify(profile),
      })
      localStorage.setItem('apictech_token', result.token)
      localStorage.setItem('apictech_user', JSON.stringify(result.user))
      await saveSettings()
    } catch (error) {
      window.alert(error.message)
    }
  }

  return (
    <Section
      title="Profile"
      description="Manage your personal beekeeper information."
    >
      <Field label="Full Name" value={profile.name} onChange={(value) => updateProfile('name', value)} />
      <Field label="Username" value={profile.username} onChange={(value) => updateProfile('username', value)} />
      <Field label="Email" value={settings.email} onChange={(value) => updateField('email', value)} />
      <Field label="Phone" value={settings.phone} onChange={(value) => updateField('phone', value)} />

      <SaveButton onClick={saveProfile} />
    </Section>
  )
}

function Organisation({ organization, offices, settings, updateField, saveSettings }) {
  const { summary } = useSummary()
  const hiveCount = summary?.hives.total ?? 0
  const info = (label, value) => (
    <div className="rounded-xl bg-[#f4fbfb] px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#5d7f80]">{label}</p>
      <p className="mt-1 text-sm font-bold">{value || '-'}</p>
    </div>
  )

  return (
    <div>
      <Section
        title="Where your organisation is registered"
        description="Fixed at registration. Your regional KVIC officer looks after this state and region."
      >
        {organization && (
          <div className="grid gap-3 sm:grid-cols-2">
            {info('Organisation', organization.name)}
            {info('Organisation code', organization.code)}
            {info('State', organization.state)}
            {info('KVIC region', organization.region)}
            {info('Registration number', organization.registrationId)}
            {info('FSSAI licence', organization.fssai)}
            {info('How you sell honey', { RETAIL: 'Packaged jars with QR codes', WHOLESALE: 'Loose honey only, wholesale', BOTH: 'Both' }[organization.sellingMode] || organization.sellingMode)}
          </div>
        )}
      </Section>


      <div className="mt-8">
        <Section
          title="Address"
          description="Buyers see this address on the Sellers nearby page, and officers use it for inspections."
        >
          {organization?.addressSample && (
            <p className="rounded-xl border border-[#f2c9c0] bg-[#fff3f0] px-4 py-3 text-sm text-[#8a3d2e]">
              This is a sample address that was filled in for now. Enter your real address and save.
            </p>
          )}
          <Field label="Apiary / business address" value={settings.addressLine} onChange={(value) => updateField('addressLine', value)} />
          <Field label="Village / town" value={settings.locality} onChange={(value) => updateField('locality', value)} />
          <Field label="District" value={settings.district} onChange={(value) => updateField('district', value)} />
          <Field label="PIN code" value={settings.pincode} onChange={(value) => updateField('pincode', value)} />
          <Field label="Farm name" value={settings.farmName} onChange={(value) => updateField('farmName', value)} />
          <Field label="Number of hives" value={String(hiveCount)} readOnly />
        </Section>
      </div>

      <div className="mt-8">
        <Section
          title="Business and payment"
          description="Used on invoices. The UPI ID is where buyers on the Sellers nearby page pay you (the QR code on their order page)."
        >
          <Field label="Business name" value={settings.businessName} onChange={(value) => updateField('businessName', value)} />
          <Field label="GSTIN" value={settings.gstin} onChange={(value) => updateField('gstin', value)} />
          <Field label="Contact email" value={settings.contactEmail} onChange={(value) => updateField('contactEmail', value)} />
          <Field label="UPI ID (for example name@okhdfcbank)" value={settings.upiId} onChange={(value) => updateField('upiId', value)} />

          <SaveButton onClick={saveSettings} />
        </Section>
      </div>

      {offices && (
        <div className="mt-8">
          <Section title="Your KVIC offices" description="Where to send documents and who to visit.">
            <div className="grid gap-3">
              {[offices.regional, offices.state, offices.central].filter(Boolean).map((office) => (
                <div key={office.level} className="rounded-xl bg-[#f4fbfb] px-4 py-3">
                  <p className="text-sm font-bold">{office.name}</p>
                  <p className="mt-1 text-sm text-gray-600">{office.address}</p>
                  {office.email && <p className="mt-1 text-xs text-gray-500">{office.email}{office.sample ? ' (sample address)' : ''}</p>}
                </div>
              ))}
            </div>
          </Section>
        </div>
      )}
    </div>
  )
}

function IoT() {
  return (
    <Section
      title="IoT Devices"
      description="Manage hive monitoring hardware and gateways."
    >

      <div className="rounded-xl bg-[#f4fbfb] p-5">

        <div className="flex items-center justify-between">

          <div>
            <p className="font-bold">
              IoT Gateway
            </p>

            <p className="mt-1 text-xs text-gray-500">
              No gateway connected
            </p>
          </div>

          <span className="rounded-full bg-gray-100 px-3 py-1.5 text-xs font-bold text-gray-500">
            Not Connected
          </span>

        </div>

      </div>

      <div className="mt-4 rounded-xl border border-dashed border-gray-200 p-5 text-center">

        <Radio
          size={28}
          className="mx-auto text-gray-400"
        />

        <p className="mt-3 font-semibold">
          Connect IoT hardware
        </p>

        <p className="mt-1 text-xs text-gray-500">
          Sensors will eventually communicate through
          the Honey Chain IoT Gateway API.
        </p>

        <button className="mt-4 rounded-xl bg-[#F97360] px-5 py-3 text-sm font-bold">
          Connect Gateway
        </button>

      </div>

    </Section>
  )
}

function Security() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' })
  const [message, setMessage] = useState({ text: '', ok: false })

  const changePassword = async (event) => {
    event.preventDefault()
    setMessage({ text: '', ok: false })

    try {
      const result = await apiRequest('/auth/password', { method: 'PUT', body: JSON.stringify(form) })
      if (result.token) localStorage.setItem('apictech_token', result.token)
      setForm({ currentPassword: '', newPassword: '' })
      setMessage({ text: 'Password updated', ok: true })
    } catch (error) {
      setMessage({ text: error.message, ok: false })
    }
  }

  return (
    <Section
      title="Security"
      description="Manage account security and authentication."
    >

      <form onSubmit={changePassword} className="rounded-xl bg-[#f4fbfb] p-5">

        <div className="flex gap-4">

          <div className="rounded-xl bg-white p-3">
            <KeyRound size={21} />
          </div>

          <div>
            <p className="font-bold">
              Password
            </p>

            <p className="mt-1 text-xs text-gray-500">
              Use at least 8 characters.
            </p>
          </div>

        </div>

        <input
          type="password"
          value={form.currentPassword}
          onChange={(event) => setForm({ ...form, currentPassword: event.target.value })}
          placeholder="Current password"
          className="mt-4 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm"
          required
        />
        <input
          type="password"
          value={form.newPassword}
          onChange={(event) => setForm({ ...form, newPassword: event.target.value })}
          placeholder="New password"
          minLength={8}
          className="mt-3 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm"
          required
        />

        <button className="mt-4 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold">
          Change Password
        </button>

        {message.text && (
          <p className={`mt-3 text-xs font-semibold ${message.ok ? 'text-teal-700' : 'text-red-600'}`}>{message.text}</p>
        )}

      </form>

      <div className="mt-4 rounded-xl bg-teal-50 p-5">

        <div className="flex gap-3">

          <Shield
            size={20}
            className="text-teal-600"
          />

          <div>

            <p className="font-bold text-teal-700">
              Account Protected
            </p>

            <p className="mt-1 text-xs text-teal-600">
              Your session is protected by signed tokens.
            </p>

          </div>

        </div>

      </div>

    </Section>
  )
}

function Section({ title, description, children }) {
  return (
    <div>

      <h2 className="text-xl font-black">
        {title}
      </h2>

      <p className="mt-1 text-sm text-gray-500">
        {description}
      </p>

      <div className="mt-6">
        {children}
      </div>

    </div>
  )
}

function Field({ label, value, onChange, readOnly = false }) {
  return (
    <div className="mb-4">

      <label className="mb-2 block text-sm font-semibold">
        {label}
      </label>

      <input
        value={value}
        readOnly={readOnly}
        onChange={(event) => onChange?.(event.target.value)}
        className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#F97360]"
      />

    </div>
  )
}

function SaveButton({ onClick }) {
  return (
    <button onClick={onClick} className="mt-2 flex items-center gap-2 rounded-xl bg-[#F97360] px-5 py-3 text-sm font-bold">
      <Save size={17} />
      Save Changes
    </button>
  )
}
// Formal closure (deregistration). The keeper starts it; a KVIC officer completes
// the government formalities. Nothing is deleted: blockchain records stay, private
// records are archived.
function Closure() {
  const [info, setInfo] = useState(null)
  const [form, setForm] = useState({ reason: '', dues: false, stock: false, records: false, password: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    apiRequest('/company/closure').then(setInfo).catch((loadError) => setError(loadError.message))
  }, [])

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setSaving(true)

    try {
      await apiRequest('/company/closure', {
        method: 'POST',
        body: JSON.stringify({
          reason: form.reason,
          password: form.password,
          declarations: { dues: form.dues, stock: form.stock, records: form.records },
        }),
      })
      await refreshSummary()
    } catch (submitError) {
      setError(submitError.message)
      setSaving(false)
    }
  }

  const box = 'mt-3 flex items-start gap-3 text-sm'

  return (
    <Section
      title="Close organisation"
      description="Formally close your organisation with KVIC. This cannot be undone once your officer completes it."
    >

      <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
        <p className="font-bold">What happens</p>
        <p className="mt-1 leading-6">
          Your request goes to your regional KVIC officer, who checks the government formalities below and then completes the closure.
          Your login is switched off, your private records are archived (not deleted) and the closure is recorded on the blockchain.
          Honey already packed with a verified certificate stays verifiable by consumers.
        </p>
      </div>

      <p className="mt-5 text-sm font-bold">Formalities your officer will check</p>
      <ul className="mt-2 space-y-2">
        {(info?.items || []).map((item) => (
          <li key={item.id} className="rounded-xl bg-[#f4fbfb] p-3 text-sm">
            <p className="font-semibold">{item.label}</p>
            <p className="mt-0.5 text-xs leading-5 text-gray-500">{item.detail}</p>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-gray-400">Keep the acknowledgement numbers ready (for example the FoSCoS surrender application and the GST REG-16 ARN). Your officer records them.</p>

      <form onSubmit={submit} className="mt-6">
        <label className="block text-sm font-semibold">Reason for closing
          <textarea value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} rows={3} className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm" required />
        </label>

        <label className={box}><input type="checkbox" checked={form.dues} onChange={(event) => setForm({ ...form, dues: event.target.checked })} className="mt-1" />I have settled all buyer, supplier and staff dues.</label>
        <label className={box}><input type="checkbox" checked={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.checked })} className="mt-1" />No honey stock is left pending, or it has been sold or disposed of with records.</label>
        <label className={box}><input type="checkbox" checked={form.records} onChange={(event) => setForm({ ...form, records: event.target.checked })} className="mt-1" />I will keep my accounts and tax records for the period the law requires.</label>

        <label className="mt-4 block text-sm font-semibold">Confirm your password
          <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm" required />
        </label>

        {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>}

        <button disabled={saving || info?.status !== 'APPROVED'} className="mt-5 rounded-xl bg-red-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">
          {saving ? 'Sending...' : 'Request closure'}
        </button>
      </form>

    </Section>
  )
}