import { useEffect, useState } from 'react'
import { FileText, Pencil } from 'lucide-react'

import { apiRequest } from '../../lib/api'
import { DOCUMENT_ACCEPT, checkDocumentFile, openOrgDocument, sizeLabel, uploadOrgDocument } from '../../lib/orgDocument'
import { ProfileForm, profileToInput } from './sections'

// A company's registration record for its owner: the Madhukranti-style details declared at registration (view and
// correct them) and the documents behind them (upload or replace). Used by the keeper's Settings and the
// wholesaler's Profile page. Data: GET/PUT /org/profile, PUT/GET /org/documents/:type.

const yesNo = (value) => (value === true ? 'Yes' : value === false ? 'No' : '—')
const list = (items) => (Array.isArray(items) && items.length ? items.join(', ') : '—')
const inr = (value) => (value ? `Rs ${Number(value).toLocaleString('en-IN')}` : '—')

function Info({ label, value }) {
  return (
    <div className="rounded-xl bg-[#f4fbfb] px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#5d7f80]">{label}</p>
      <p className="mt-1 break-words text-sm font-bold">{value === undefined || value === null || value === '' ? '—' : value}</p>
    </div>
  )
}

function Group({ title, children }) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-[#0F766E]">{title}</h4>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  )
}

export function ProfileSummary({ profile, catalog }) {
  if (!profile) return <p className="text-sm text-gray-500">No registration details on file yet.</p>
  const { applicant = {}, entity, authorised, nominee, bank, business, beekeeping, production, quality, trade } = profile
  const other = production?.other || {}
  return (
    <div className="grid gap-5">
      <Group title="Applicant">
        <Info label="Registered as" value={catalog?.categories[profile.category]?.label || profile.category} />
        <Info label="Name" value={applicant.name} />
        <Info label="Father's / husband's name" value={applicant.fatherHusbandName} />
        <Info label="Date of birth" value={applicant.dob} />
        <Info label="Gender" value={applicant.gender} />
        <Info label="Education" value={applicant.education} />
        <Info label="Social category" value={applicant.socialCategory} />
        {applicant.aadhaarLast4 && <Info label="Aadhaar" value={`XXXX XXXX ${applicant.aadhaarLast4}`} />}
        <Info label="PAN" value={applicant.pan} />
        {applicant.altPhone && <Info label="Alternate mobile" value={applicant.altPhone} />}
      </Group>
      {entity && (
        <Group title="Organisation">
          <Info label="Type" value={entity.kind} />
          <Info label="Registration number" value={entity.registrationNo} />
          <Info label="Registered on" value={entity.registrationDate} />
          {entity.cin && <Info label="CIN" value={entity.cin} />}
          {entity.membersCount && <Info label="Members" value={entity.membersCount} />}
          {authorised && <Info label="Authorised person" value={`${authorised.name} (${authorised.designation})`} />}
          {authorised?.aadhaarLast4 && <Info label="Their Aadhaar" value={`XXXX XXXX ${authorised.aadhaarLast4}`} />}
        </Group>
      )}
      {(nominee || bank || business) && (
        <Group title="Nominee, bank and place of business">
          {nominee && <Info label="Nominee" value={`${nominee.name} (${nominee.relation}, born ${nominee.dob})`} />}
          {bank && <Info label="Bank" value={`${bank.bankName} · ${bank.ifsc}`} />}
          {bank && <Info label="Account" value={`${bank.holderName || ''} · XXXX${bank.accountLast4}`} />}
          {business && <Info label="Business activity at" value={[business.address, business.district, business.state].filter(Boolean).join(', ')} />}
        </Group>
      )}
      {beekeeping && (
        <Group title="Bees">
          <Info label="Colonies" value={beekeeping.colonies} />
          <Info label="Species" value={list(beekeeping.species)} />
          <Info label="Experience" value={`${beekeeping.experienceYears} years`} />
          <Info label="Plan to increase" value={beekeeping.planIncrease ? beekeeping.planText : 'No'} />
          <Info label="FPO / cooperative" value={beekeeping.fpo?.member ? `${beekeeping.fpo.name}${beekeeping.fpo.regNo ? ` (${beekeeping.fpo.regNo})` : ''}` : 'Not a member'} />
          <Info label="Land" value={[beekeeping.land?.type, beekeeping.land?.district, beekeeping.land?.state].filter(Boolean).join(', ')} />
          <Info label="Migration" value={beekeeping.migration ? `${beekeeping.migration.from} to ${beekeeping.migration.to}${beekeeping.migration.mainCrop ? ` · ${beekeeping.migration.mainCrop}` : ''}` : 'Stationary'} />
          <Info label="Training" value={(beekeeping.training || []).length ? beekeeping.training.map((item) => `${item.name} (${item.organisedBy})`).join('; ') : 'None'} />
        </Group>
      )}
      {production && (
        <Group title="Last year's production">
          <Info label="Honey produced / sold" value={`${production.honeyProducedKg} kg / ${production.honeySoldKg} kg`} />
          <Info label="Average price" value={production.avgPriceKg ? `${inr(production.avgPriceKg)} per kg` : '—'} />
          <Info label="Sold to" value={list(production.soldTo)} />
          <Info label="Colonies multiplied / sold" value={`${production.coloniesMultiplied} / ${production.coloniesSold}`} />
          <Info label="Beehives made / sold" value={`${production.hivesManufactured} / ${production.hivesSold}`} />
          <Info label="Other bee products" value={Object.keys(other).length ? Object.entries(other).map(([key, item]) => `${catalog?.options.otherProducts[key]?.label || key} ${item.produced}`).join(', ') : 'None'} />
        </Group>
      )}
      {quality && (
        <Group title="Disease management and quality">
          <Info label="Medicines used" value={quality.medicinesUsed ? quality.medicinesDetails : 'No'} />
          <Info label="Antibiotics used" value={quality.antibioticsUsed ? `${quality.antibioticDetails}${quality.professionalSupervision ? ' (supervised)' : ''}` : 'No'} />
          {quality.withdrawalPeriod && <Info label="Withdrawal period" value={quality.withdrawalPeriod} />}
          <Info label="Records kept" value={yesNo(quality.recordsMaintained)} />
          <Info label="Food-grade equipment" value={yesNo(quality.qualityEquipment)} />
          <Info label="Containers" value={quality.containers?.count ? `${quality.containers.count} × ${quality.containers.capacityKg} kg ${quality.containers.type || ''}` : '—'} />
        </Group>
      )}
      {trade && (
        <Group title="Trade">
          <Info label="Business type" value={trade.businessType} />
          <Info label="Trade licence" value={trade.tradeLicenceNo} />
          {trade.brandName && <Info label="Brand" value={trade.brandName} />}
          {trade.iec && <Info label="IEC" value={trade.iec} />}
          <Info label="Storage capacity" value={`${Number(trade.storageCapacityKg).toLocaleString('en-IN')} kg`} />
          <Info label="Buys per month" value={`${Number(trade.monthlyPurchaseKg).toLocaleString('en-IN')} kg`} />
          <Info label="Warehouse" value={trade.warehouseAddress} />
          <Info label="Buys from" value={list(trade.sourcingStates)} />
          <Info label="Packaging" value={list(trade.packagingTypes)} />
        </Group>
      )}
    </div>
  )
}

export function DocumentsPanel({ documents, onChanged }) {
  const [error, setError] = useState('')
  const [busyType, setBusyType] = useState('')

  async function open(type) {
    setError('')
    try { await openOrgDocument(type) } catch (err) { setError(err.message) }
  }

  async function upload(type, file) {
    const invalid = checkDocumentFile(file)
    if (invalid) { setError(invalid); return }
    setError(''); setBusyType(type)
    try { await uploadOrgDocument(type, file); await onChanged() } catch (err) { setError(err.message) } finally { setBusyType('') }
  }

  return (
    <div>
      <div className="grid gap-2">
        {(documents || []).map((doc) => (
          <div key={doc.docType} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#f4fbfb] px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <FileText size={18} className={`shrink-0 ${doc.fileName ? 'text-[#0F766E]' : doc.required ? 'text-[#c2410c]' : 'text-gray-400'}`} />
              <div className="min-w-0">
                <p className="text-sm font-bold">{doc.label} {doc.required ? <span className="text-xs font-semibold text-[#c2410c]">required</span> : <span className="text-xs font-normal text-gray-400">optional</span>}</p>
                {doc.fileName
                  ? <button type="button" onClick={() => open(doc.docType)} className="truncate text-left text-xs text-[#0F766E] hover:underline">{doc.fileName} · {sizeLabel(doc.sizeBytes)} · {doc.contentType === 'application/pdf' ? 'PDF' : 'photo'} · click to open</button>
                  : <p className="text-xs text-gray-400">Not uploaded yet</p>}
              </div>
            </div>
            <label className="shrink-0 cursor-pointer rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold hover:bg-gray-50">
              {busyType === doc.docType ? 'Uploading…' : doc.fileName ? 'Replace' : 'Upload'}
              <input type="file" accept={DOCUMENT_ACCEPT} className="hidden" disabled={busyType === doc.docType} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) upload(doc.docType, file) }} />
            </label>
          </div>
        ))}
      </div>
      {error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>}
    </div>
  )
}

export default function RegistrationDetails() {
  const [data, setData] = useState(null)
  const [catalog, setCatalog] = useState(null)
  const [regions, setRegions] = useState({})
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(null)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const [profileData, loadedCatalog, loadedRegions] = await Promise.all([apiRequest('/org/profile'), apiRequest('/auth/catalog'), apiRequest('/regions')])
    setData(profileData); setCatalog(loadedCatalog); setRegions(loadedRegions)
  }

  useEffect(() => { load().catch((err) => setMessage(err.message)) }, [])

  const reloadDocuments = async () => setData({ ...data, documents: await apiRequest('/org/documents') })

  const save = async () => {
    setSaving(true); setMessage('')
    try {
      const saved = await apiRequest('/org/profile', { method: 'PUT', body: JSON.stringify({ profile: draft }) })
      setData(saved); setEditing(false); setMessage('Saved. Your regional officer sees the updated details.')
    } catch (err) {
      setMessage(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!data || !catalog) return <p className="text-sm text-gray-500">{message || 'Loading registration details…'}</p>
  const { profile, documents } = data
  const missing = (documents || []).filter((doc) => doc.required && !doc.fileName)

  return (
    <div className="grid gap-8">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black">Registration details</h3>
            <p className="text-sm text-gray-500">What you declared when registering (the National Bee Board's Madhukranti details). Keep them up to date.</p>
          </div>
          {!editing && (
            <button onClick={() => { setDraft(profileToInput(profile)); setEditing(true); setMessage('') }} className="flex items-center gap-2 rounded-xl border border-[#c6e2e0] px-4 py-2 text-sm font-bold hover:bg-[#f4fbfb]">
              <Pencil size={15} /> Edit details
            </button>
          )}
        </div>
        {profile?.sample && (
          <p className="mt-4 rounded-xl border border-[#f2c9c0] bg-[#fff3f0] px-4 py-3 text-sm text-[#8a3d2e]">
            These are sample details filled in for demonstration, because this account registered before the full form existed. Edit them to your real details and save.
          </p>
        )}
        <div className="mt-5">
          {editing ? (
            <>
              <ProfileForm category={profile?.category || 'INDIVIDUAL'} value={draft} onChange={setDraft} catalog={catalog} regions={regions} saved={profile} />
              <div className="mt-5 flex gap-3">
                <button onClick={save} disabled={saving} className="rounded-xl bg-[#0F766E] px-6 py-3 text-sm font-bold text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save details'}</button>
                <button onClick={() => { setEditing(false); setMessage('') }} className="rounded-xl border border-gray-200 px-6 py-3 text-sm font-bold">Cancel</button>
              </div>
            </>
          ) : <ProfileSummary profile={profile} catalog={catalog} />}
        </div>
        {message && <p className={`mt-4 rounded-xl p-3 text-sm ${/^Saved/.test(message) ? 'bg-[#e6f3f2] text-[#0F766E]' : 'bg-red-50 text-red-600'}`}>{message}</p>}
      </div>

      <div>
        <h3 className="text-lg font-black">Documents</h3>
        <p className="text-sm text-gray-500">A PDF scan or a clear photo (JPG / PNG), up to 10 MB. Your regional officer sees these when reviewing you; uploading again replaces a file.</p>
        {missing.length > 0 && <p className="mt-3 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">Still needed: {missing.map((doc) => doc.label).join('; ')}.</p>}
        <div className="mt-4"><DocumentsPanel documents={documents} onChanged={reloadDocuments} /></div>
      </div>
    </div>
  )
}
