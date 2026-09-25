import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Building2, Check, Eye, EyeOff, FileText, Landmark, Store, User, Users } from 'lucide-react'

import { apiRequest } from '../lib/api'
import { resetSummary } from '../lib/store'
import { LanguageToggle } from '../i18n'
import { DOCUMENT_ACCEPT, checkDocumentFile, sizeLabel, uploadOrgDocument } from '../lib/orgDocument'
import { Card, Field, Select, TextArea } from '../components/registration/fields'
import {
  ApplicantSection, BeekeepingSection, EntitySection, NomineeBankSection, ProductionSection, QualitySection, TradeSection, checkStep, emptyProfile,
} from '../components/registration/sections'

// Registration, modelled on the National Bee Board's Madhukranti portal: pick how you are registering
// (individual, firm, society, company or wholesaler), then the details that category needs, then the documents.
// Everything is checked again on the server (services/registrationProfile.js); the regional KVIC officer reviews
// the application before the account can record honey or trade.

const ICONS = { INDIVIDUAL: User, FIRM: Store, SOCIETY: Users, COMPANY: Building2, WHOLESALER: Landmark }

const SELLING_MODES = [
  { value: 'RETAIL', label: 'Packaged jars with QR codes', hint: 'Sold on Sellers nearby or by hand. Needs someone who can print and stick a QR label on each jar.' },
  { value: 'WHOLESALE', label: 'Loose honey only, wholesale', hint: 'No jars or QR codes. Sold by weight to registered wholesalers on an invoice.' },
  { value: 'BOTH', label: 'Both', hint: 'Start with whichever suits you; a KVIC officer can switch this any time.' },
]

const EMPTY_ACCOUNT = {
  name: '', organizationName: '', organizationType: 'KVIC_BEEKEEPER', registrationBody: '', registrationId: '', fssaiLicense: '', gstin: '',
  state: '', region: '', addressLine: '', locality: '', district: '', pincode: '', phone: '', email: '', sellingMode: 'BOTH',
  username: '', password: '', confirm: '',
}

function stepsFor(category, catalog) {
  const producer = catalog?.categories[category]?.producer
  return [
    { id: 'category', title: 'Who is registering' },
    { id: 'account', title: 'Organisation and login' },
    { id: 'identity', title: 'Identity and bank' },
    ...(producer ? [{ id: 'bees', title: 'Bees and training' }, { id: 'production', title: 'Production and quality' }] : [{ id: 'trade', title: 'Trade details' }]),
    { id: 'documents', title: 'Documents and submit' },
  ]
}

function checkAccount(account, trader) {
  if (account.name.trim().length < 2 || account.organizationName.trim().length < 2) return 'Enter your full name and the organisation / farm name.'
  if (!/^[A-Za-z0-9][A-Za-z0-9/_-]{3,39}$/.test(account.registrationId.trim())) return trader ? 'Enter your National Bee Board (Madhukranti) trader / packer registration number.' : 'Enter your KVIC / Madhukranti registration number (letters, digits, / - _).'
  if (!trader && account.organizationType !== 'KVIC_BEEKEEPER' && !account.registrationBody.trim()) return 'Enter the organisation that issued your registration number.'
  if (!/^\d{14}$/.test(account.fssaiLicense.trim())) return 'The FSSAI licence number must be 14 digits.'
  if (trader && !account.gstin.trim()) return 'A wholesaler needs a GSTIN.'
  if (account.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(account.gstin.trim())) return 'The GSTIN format is not valid (15 characters, like 33ABCDE1234F1Z5).'
  if (!account.state || !account.region) return 'Choose your state and KVIC region.'
  if (account.addressLine.trim().length < 5 || account.locality.trim().length < 2 || !/^\d{6}$/.test(account.pincode.trim())) return 'Enter the address, village / town and 6-digit PIN code.'
  if (!/^[6-9]\d{9}$/.test(account.phone.replace(/\D/g, '').slice(-10))) return 'Enter a 10-digit mobile number.'
  if (account.username.trim().length < 3) return 'Choose a username.'
  if (account.password.length < 8) return 'The password must be at least 8 characters.'
  if (account.password !== account.confirm) return 'The two passwords do not match.'
  return ''
}

// Messages from the server that are about the organisation / login step rather than the profile.
const ACCOUNT_ERRORS = /username|fssai|registration number|gstin|mobile|pin code|address|village|state and kvic|password|name, username/i

export default function Register() {
  const navigate = useNavigate()
  const [catalog, setCatalog] = useState(null)
  const [regions, setRegions] = useState({})
  const [loadError, setLoadError] = useState('')
  const [category, setCategory] = useState('')
  const [account, setAccount] = useState(EMPTY_ACCOUNT)
  const [profile, setProfile] = useState(emptyProfile)
  const [files, setFiles] = useState({})
  const [fileErrors, setFileErrors] = useState({})
  const [declared, setDeclared] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    Promise.all([apiRequest('/auth/catalog'), apiRequest('/regions')])
      .then(([loadedCatalog, loadedRegions]) => { setCatalog(loadedCatalog); setRegions(loadedRegions) })
      .catch((err) => setLoadError(err.message || 'The registration form could not be loaded. Check your connection.'))
  }, [])

  const steps = useMemo(() => stepsFor(category, catalog), [category, catalog])
  const step = steps[stepIndex]
  const trader = category === 'WHOLESALER'
  const info = catalog?.categories[category]
  const set = (field) => (value) => setAccount((current) => ({ ...current, [field]: field === 'gstin' ? value.toUpperCase() : value, ...(field === 'state' ? { region: '' } : {}) }))
  const sectionProps = { category, value: profile, onChange: setProfile, catalog, regions }

  const fee = useMemo(() => {
    if (!catalog || !info?.producer) return null
    const colonies = Number(profile.beekeeping?.colonies)
    const slab = catalog.fees.slabs.find((item) => colonies >= item.from && (item.to === null || colonies <= item.to))
    return slab ? { colonies, slab, total: slab.fee + catalog.fees.sms + catalog.fees.convenience } : null
  }, [catalog, info, profile.beekeeping?.colonies])

  const go = (delta) => {
    setError('')
    if (delta > 0) {
      const problem = step.id === 'category' ? (category ? '' : 'Choose how you are registering.')
        : step.id === 'account' ? checkAccount(account, trader)
        : checkStep(step.id, category, profile)
      if (problem) { setError(problem); return }
    }
    setStepIndex((index) => Math.min(Math.max(index + delta, 0), steps.length - 1))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const chooseFile = (type, file) => {
    const problem = checkDocumentFile(file)
    setFileErrors((current) => ({ ...current, [type]: problem }))
    setFiles((current) => ({ ...current, [type]: problem ? null : file }))
  }

  const submit = async () => {
    setError('')
    if (!declared) { setError('Tick the declaration to submit.'); return }
    setBusy(true)
    try {
      const { confirm, ...fields } = account
      void confirm
      const { token, user, fee: serverFee } = await apiRequest('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ ...fields, username: fields.username.trim(), category, profile: trader ? { ...profile, beekeeping: undefined, production: undefined, quality: undefined } : { ...profile, trade: undefined } }),
      })

      // The account exists from here on: a document that fails to upload is reported, not a reason to undo it.
      const uploaded = []
      const failed = []
      for (const [type, file] of Object.entries(files)) {
        if (!file) continue
        try { await uploadOrgDocument(type, file, token); uploaded.push(type) } catch (err) { failed.push(`${catalog.categories[category].documents.find((doc) => doc.type === type)?.label || type}: ${err.message}`) }
      }

      resetSummary()
      localStorage.setItem('apictech_token', token)
      localStorage.setItem('apictech_user', JSON.stringify(user))
      setDone({ user, fee: serverFee, uploaded, failed })
    } catch (err) {
      setError(err.message)
      if (ACCOUNT_ERRORS.test(err.message)) setStepIndex(1)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    const missing = info.documents.filter((doc) => doc.required && !done.uploaded.includes(doc.type))
    return (
      <Shell wide={false}>
        <div className="rounded-3xl border border-[#c6e2e0] bg-white p-8 text-center shadow-[0_20px_60px_rgba(21,49,55,0.08)]">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#0F766E] text-white"><Check size={32} /></div>
          <h2 className="mt-5 text-2xl font-black">Application submitted</h2>
          <p className="mt-2 text-sm text-gray-500">{done.user.organization?.name} · {done.user.organization?.code}</p>
          <p className="mt-4 text-sm text-gray-600">Your regional KVIC officer ({account.region}, {account.state}) will review it. You can sign in now and follow the status.</p>
          {done.fee && (
            <p className="mt-4 rounded-xl bg-[#f4fbfb] p-3 text-sm">Registration charge for {done.fee.slab.from}{done.fee.slab.to ? `–${done.fee.slab.to}` : '+'} colonies: <b>Rs {done.fee.total.toLocaleString('en-IN')}</b> (Rs {done.fee.registration} + SMS Rs {done.fee.sms} + convenience Rs {done.fee.convenience}), paid when the officer asks for it.</p>
          )}
          {missing.length > 0 && <p className="mt-3 rounded-xl border border-orange-200 bg-orange-50 p-3 text-left text-sm text-orange-900">Still needed: {missing.map((doc) => doc.label).join('; ')}. Add them from {trader ? 'Profile' : 'Settings > Registration & documents'} so the officer can approve you.</p>}
          {done.failed.length > 0 && <p className="mt-3 rounded-xl bg-red-50 p-3 text-left text-sm text-red-600">Not uploaded: {done.failed.join(' · ')}</p>}
          <button onClick={() => navigate(done.user.role === 'WHOLESALER' ? '/trade' : '/dashboard')} className="mt-6 w-full rounded-xl bg-[#0F766E] py-3 font-bold text-white hover:bg-[#115e59]">Continue</button>
        </div>
      </Shell>
    )
  }

  return (
    <Shell wide>
      <div className="mb-6">
        <Link to="/login" className="inline-flex items-center gap-1 text-sm font-bold text-[#168481] hover:underline"><ArrowLeft size={15} /> Back to sign in</Link>
        <p className="mt-4 text-xs font-bold uppercase tracking-[0.2em] text-[#199995]">Join the KVIC monitoring chain</p>
        <h2 className="mt-2 text-3xl font-black">Register {info ? `as ${/^[aeiou]/i.test(info.label) ? 'an' : 'a'} ${info.label.toLowerCase()}` : 'your organisation'}</h2>
        <p className="mt-1 text-sm text-gray-500">The same details as the National Bee Board's Madhukranti registration. Your regional KVIC officer reviews them before you can start.</p>
      </div>

      {/* progress */}
      <ol className="mb-6 flex gap-1.5 overflow-x-auto pb-1">
        {steps.map((item, index) => (
          <li key={item.id} className="min-w-[88px] flex-1">
            <div className={`h-1.5 rounded-full ${index <= stepIndex ? 'bg-[#0F766E]' : 'bg-[#d4e9e8]'}`} />
            <p className={`mt-1.5 text-[11px] font-semibold ${index === stepIndex ? 'text-[#0F766E]' : 'text-gray-400'}`}>{index + 1}. {item.title}</p>
          </li>
        ))}
      </ol>

      {loadError && <p className="rounded-xl bg-red-50 p-4 text-sm text-red-600">{loadError}</p>}
      {!catalog && !loadError && <p className="text-sm text-gray-500">Loading the registration form…</p>}

      {catalog && (
        <div className="grid gap-5">
          {step.id === 'category' && (
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries(catalog.categories).map(([key, item]) => {
                const Icon = ICONS[key] || User
                const chosen = category === key
                return (
                  <button
                    type="button" key={key}
                    onClick={() => { setCategory(key); setError(''); setProfile((current) => ({ ...current, entity: {} })) }}
                    className={`flex gap-4 rounded-2xl border p-5 text-left transition ${chosen ? 'border-[#F97360] bg-[#fff4f0] shadow-sm' : 'border-[#c6e2e0] bg-white hover:border-[#0F766E]'} ${key === 'WHOLESALER' ? 'sm:col-span-2' : ''}`}
                  >
                    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${chosen ? 'bg-[#F97360] text-[#14272e]' : 'bg-[#e6f3f2] text-[#0F766E]'}`}><Icon size={22} /></span>
                    <span>
                      <span className="block font-black">{item.label}</span>
                      <span className="mt-1 block text-xs text-gray-500">{item.hint}</span>
                      <span className="mt-2 block text-[11px] font-semibold text-[#5d7f80]">{item.producer ? 'Records hives, harvests, lab tests and sales' : 'Buys lab-verified honey from registered beekeepers'}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {step.id === 'account' && (
            <>
              <Card title="Organisation" description={trader ? 'As on your GST and FSSAI registrations.' : 'As registered with KVIC or your parent organisation.'}>
                <Field label={trader ? 'Proprietor / contact person full name' : 'Your full name'} value={account.name} onChange={set('name')} />
                <Field label={trader ? 'Business (trade) name' : 'Organisation / farm name'} value={account.organizationName} onChange={set('organizationName')} />
                {!trader && (
                  <Select label="Registered through" className="sm:col-span-2" value={account.organizationType} onChange={set('organizationType')} placeholder="Select" options={Object.entries(catalog.organizationTypes).map(([value, label]) => ({ value, label }))} />
                )}
                <Field
                  label={trader ? 'NBB (Madhukranti) trader / packer registration number' : account.organizationType === 'KVIC_BEEKEEPER' ? 'KVIC Madhukranti ID' : 'Registration number'}
                  placeholder={trader ? 'e.g. NBB-TR-TN-00123' : 'e.g. MK-TN-000123'} value={account.registrationId} onChange={set('registrationId')}
                />
                {!trader && account.organizationType !== 'KVIC_BEEKEEPER' && <Field label="Issuing organisation" placeholder="e.g. Madurai Beekeepers FPO" value={account.registrationBody} onChange={set('registrationBody')} />}
                <Field label="FSSAI licence number" inputMode="numeric" maxLength={14} placeholder="14 digits" value={account.fssaiLicense} onChange={set('fssaiLicense')} />
                <Field label="GSTIN" optional={!trader} maxLength={15} placeholder="15 characters" value={account.gstin} onChange={set('gstin')} />
              </Card>

              {!trader && (
                <section className="rounded-2xl border border-[#d4e9e8] bg-white p-5">
                  <h3 className="text-base font-black">How do you plan to sell honey?</h3>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {SELLING_MODES.map((mode) => (
                      <label key={mode.value} className={`cursor-pointer rounded-xl border p-3 text-sm ${account.sellingMode === mode.value ? 'border-[#F97360] bg-[#fff4f0]' : 'border-[#c6e2e0] bg-[#f7fbfb]'}`}>
                        <span className="flex items-center gap-2 font-semibold"><input type="radio" name="sellingMode" value={mode.value} checked={account.sellingMode === mode.value} onChange={(event) => set('sellingMode')(event.target.value)} />{mode.label}</span>
                        <span className="mt-1 block text-xs text-gray-500">{mode.hint}</span>
                      </label>
                    ))}
                  </div>
                </section>
              )}

              <Card title={trader ? 'Business address' : 'Apiary / business address'} description="Your KVIC region decides which regional officer reviews you.">
                <Select label="State" value={account.state} onChange={set('state')} options={Object.keys(regions)} placeholder="Select state" />
                <Select label="KVIC region" value={account.region} onChange={set('region')} options={regions[account.state] || []} placeholder="Select region" disabled={!account.state} />
                <TextArea label="House / plot number, street" className="sm:col-span-2" value={account.addressLine} onChange={set('addressLine')} />
                <Field label="Village / town" value={account.locality} onChange={set('locality')} />
                <Field label="District" optional value={account.district} onChange={set('district')} />
                <Field label="PIN code" inputMode="numeric" maxLength={6} value={account.pincode} onChange={set('pincode')} />
              </Card>

              <Card title="Contact and login">
                <Field label="Mobile number" inputMode="numeric" maxLength={13} placeholder="9876543210" value={account.phone} onChange={set('phone')} />
                <Field label="Email" optional type="email" value={account.email} onChange={set('email')} />
                <Field label="Username" autoComplete="username" value={account.username} onChange={set('username')} />
                <span className="hidden sm:block" />
                <Field label="Password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="At least 8 characters" value={account.password} onChange={set('password')} />
                <Field label="Confirm password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={account.confirm} onChange={set('confirm')} error={account.confirm && account.confirm !== account.password ? 'Does not match' : ''} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="flex w-fit items-center gap-2 text-xs font-bold text-[#168481]">
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />} {showPassword ? 'Hide' : 'Show'} passwords
                </button>
              </Card>
            </>
          )}

          {step.id === 'identity' && <>
            <EntitySection {...sectionProps} />
            <ApplicantSection {...sectionProps} />
            <NomineeBankSection {...sectionProps} />
          </>}

          {step.id === 'bees' && <BeekeepingSection {...sectionProps} />}
          {step.id === 'production' && <>
            <ProductionSection {...sectionProps} />
            <QualitySection {...sectionProps} />
          </>}
          {step.id === 'trade' && <TradeSection {...sectionProps} />}

          {step.id === 'documents' && (
            <>
              <section className="rounded-2xl border border-[#d4e9e8] bg-white p-5">
                <h3 className="text-base font-black">Documents</h3>
                <p className="mt-0.5 text-xs text-gray-500">A PDF scan or a clear phone photo (JPG / PNG), up to 10 MB each. Your officer needs the required ones to approve you; you can also add them after registering.</p>
                <div className="mt-4 grid gap-2">
                  {info.documents.map((doc) => (
                    <div key={doc.type} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#f7fbfb] px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <FileText size={18} className={`shrink-0 ${files[doc.type] ? 'text-[#0F766E]' : 'text-gray-400'}`} />
                        <div className="min-w-0">
                          <p className="text-sm font-bold">{doc.label} {doc.required ? <span className="text-xs font-semibold text-[#c2410c]">required</span> : <span className="text-xs font-normal text-gray-400">optional</span>}</p>
                          {files[doc.type] ? <p className="truncate text-xs text-[#0F766E]">{files[doc.type].name} · {sizeLabel(files[doc.type].size)}</p> : <p className="text-xs text-gray-400">No file chosen</p>}
                          {fileErrors[doc.type] && <p className="text-xs font-semibold text-red-600">{fileErrors[doc.type]}</p>}
                        </div>
                      </div>
                      <label className="shrink-0 cursor-pointer rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold hover:bg-gray-50">
                        {files[doc.type] ? 'Change' : 'Choose file'}
                        <input type="file" accept={DOCUMENT_ACCEPT} className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) chooseFile(doc.type, file) }} />
                      </label>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-[#d4e9e8] bg-white p-5">
                <h3 className="text-base font-black">Registration charge</h3>
                {info.producer ? (
                  fee ? (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full text-sm">
                        <tbody>
                          <tr><td className="py-1 text-gray-500">Registration ({fee.slab.from}{fee.slab.to ? `–${fee.slab.to}` : '+'} colonies; you have {fee.colonies})</td><td className="py-1 text-right font-semibold">Rs {fee.slab.fee.toLocaleString('en-IN')}</td></tr>
                          <tr><td className="py-1 text-gray-500">SMS service (5 years)</td><td className="py-1 text-right font-semibold">Rs {catalog.fees.sms}</td></tr>
                          <tr><td className="py-1 text-gray-500">Convenience fee</td><td className="py-1 text-right font-semibold">Rs {catalog.fees.convenience}</td></tr>
                          <tr className="border-t border-[#d4e9e8]"><td className="pt-2 font-black">Total</td><td className="pt-2 text-right font-black">Rs {fee.total.toLocaleString('en-IN')}</td></tr>
                        </tbody>
                      </table>
                      <p className="mt-2 text-xs text-gray-400">Slabs from the National Bee Board guidelines. Nothing is charged here: pay when your officer asks for it.</p>
                    </div>
                  ) : <p className="mt-2 text-sm text-gray-500">Enter your number of colonies to see the charge.</p>
                ) : <p className="mt-2 text-sm text-gray-500">Wholesalers pay the trader / packer registration fee notified by the National Bee Board. Nothing is charged here.</p>}
              </section>

              <label className="flex items-start gap-3 rounded-2xl border border-[#d4e9e8] bg-white p-5 text-sm">
                <input type="checkbox" checked={declared} onChange={(event) => setDeclared(event.target.checked)} className="mt-1" />
                <span>I declare that the details above are true to the best of my knowledge, that the documents are genuine, and that I will follow the National Bee Board's guidelines on the use of medicines and antibiotics{trader ? ' and buy honey only at or above the KVIC minimum price' : ''}. A false declaration can lead to the registration being cancelled.</span>
              </label>
            </>
          )}

          {error && <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-600">{error}</p>}

          <div className="flex gap-3">
            {stepIndex > 0 && (
              <button type="button" onClick={() => go(-1)} className="flex items-center gap-2 rounded-xl border border-[#c6e2e0] bg-white px-5 py-3 text-sm font-bold hover:bg-gray-50"><ArrowLeft size={16} /> Back</button>
            )}
            {step.id !== 'documents' ? (
              <button type="button" onClick={() => go(1)} className="ml-auto flex items-center gap-2 rounded-xl bg-[#0F766E] px-6 py-3 text-sm font-bold text-white hover:bg-[#115e59]">Next <ArrowRight size={16} /></button>
            ) : (
              <button type="button" onClick={submit} disabled={busy} className="ml-auto rounded-xl bg-[#0F766E] px-6 py-3 text-sm font-bold text-white hover:bg-[#115e59] disabled:opacity-60">{busy ? 'Submitting…' : 'Submit for approval'}</button>
            )}
          </div>
        </div>
      )}
    </Shell>
  )
}

function Shell({ children, wide }) {
  return (
    <div className="app-shell min-h-screen px-4 py-8 text-[#122c31] sm:px-6">
      <div className="fixed right-5 top-5 z-50"><LanguageToggle /></div>
      <div className={`mx-auto w-full ${wide ? 'max-w-3xl' : 'max-w-lg'}`}>
        <img src="/apictech-logo.png" alt="Honey Chain" className="mb-4 h-14 w-14 rounded-full" />
        {children}
      </div>
    </div>
  )
}
