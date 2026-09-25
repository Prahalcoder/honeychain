import { Plus, Trash2 } from 'lucide-react'
import { Card, Checks, Field, Select, TextArea, YesNo, getIn, setIn, validAadhaar } from './fields'

// The sections of the Madhukranti-style registration form. Each takes the whole profile (`value`), a setter and
// the catalogue from GET /auth/catalog, so the wizard can show them one step at a time and the editor all at once.
// Field names match services/registrationProfile.js on the server.

const bind = (value, onChange) => (path) => ({ value: getIn(value, path), onChange: (next) => onChange(setIn(value, path, next)) })

const aadhaarError = (text) => (text && !validAadhaar(text) ? 'Not a valid 12-digit Aadhaar number' : '')
const PAN_HINT = 'Like ABCDE1234F'

export function emptyProfile() {
  return {
    applicant: {}, entity: {}, authorised: {}, nominee: {}, bank: {}, business: {},
    beekeeping: { species: [], planIncrease: false, fpo: { member: false }, land: {}, migration: {}, training: [] },
    production: { soldTo: [], other: {} },
    quality: { medicinesUsed: false, antibioticsUsed: false, recordsMaintained: true, purchaseBillsAvailable: false, qualityEquipment: true, containers: {} },
    trade: { sourcingStates: [], packagingTypes: [], honeyTypes: [] },
  }
}

// A saved profile (GET /org/profile) back into form input. Aadhaar and bank account numbers are never sent back
// (only the last 4 digits are kept), so those fields start empty and stay unchanged unless typed again.
export function profileToInput(profile) {
  if (!profile) return emptyProfile()
  const base = emptyProfile()
  const { applicant = {}, entity, authorised, nominee, bank, business } = profile
  return {
    ...base,
    applicant: { ...applicant, aadhaar: '' },
    entity: entity || {},
    authorised: authorised ? { ...authorised, aadhaar: '' } : {},
    nominee: nominee || {},
    bank: bank ? { holderName: bank.holderName, bankName: bank.bankName, ifsc: bank.ifsc, accountNumber: '' } : {},
    business: business || {},
    beekeeping: profile.beekeeping ? { ...base.beekeeping, ...profile.beekeeping, migration: profile.beekeeping.migration || {}, land: profile.beekeeping.land || {} } : base.beekeeping,
    production: profile.production ? { ...base.production, ...profile.production } : base.production,
    quality: profile.quality ? { ...base.quality, ...profile.quality, containers: profile.quality.containers || {} } : base.quality,
    trade: profile.trade ? { ...base.trade, ...profile.trade } : base.trade,
  }
}

// ------------------------------------------------------------------ applicant & organisation
export function ApplicantSection({ category, value, onChange, catalog, saved }) {
  const f = bind(value, onChange)
  const individual = category === 'INDIVIDUAL'
  const proprietor = category === 'WHOLESALER' && getIn(value, 'entity.kind') === 'Proprietorship'
  const needsAadhaar = individual || proprietor
  const kept = saved?.applicant?.aadhaarLast4
  const o = catalog.options

  return (
    <Card
      title={individual ? 'Applicant' : 'Applicant (the person filling this in)'}
      description="As on your Aadhaar card. Only the last 4 digits of the Aadhaar number are stored."
    >
      <Field label="Father's / husband's name" optional={!individual} {...f('applicant.fatherHusbandName')} />
      <Field label="Date of birth" type="date" optional={!individual} max={new Date().toISOString().slice(0, 10)} {...f('applicant.dob')} />
      <Select label="Gender" optional={!individual} options={o.genders} {...f('applicant.gender')} />
      <Select label="Educational qualification" optional={!individual} options={o.education} {...f('applicant.education')} />
      <Select label="Social category" optional options={o.socialCategories} {...f('applicant.socialCategory')} />
      {needsAadhaar && (
        <Field
          label="Aadhaar number" inputMode="numeric" maxLength={14} placeholder={kept ? `Saved: ending ${kept} (leave blank to keep)` : '12 digits'}
          error={aadhaarError(getIn(value, 'applicant.aadhaar'))} {...f('applicant.aadhaar')}
        />
      )}
      <Field
        label={individual ? 'PAN' : `PAN of the ${catalog.categories[category].label.toLowerCase()}`} optional={individual} hint={PAN_HINT} maxLength={10}
        value={getIn(value, 'applicant.pan')} onChange={(next) => onChange(setIn(value, 'applicant.pan', next.toUpperCase()))}
      />
      <Field label="Alternate mobile number" optional inputMode="numeric" maxLength={10} {...f('applicant.altPhone')} />
    </Card>
  )
}

export function EntitySection({ category, value, onChange, catalog, saved }) {
  const f = bind(value, onChange)
  const info = catalog.categories[category]
  if (!info?.entity) return null
  const kind = getIn(value, 'entity.kind')
  const proprietor = category === 'WHOLESALER' && kind === 'Proprietorship'
  const needsCin = category === 'COMPANY' || (category === 'WHOLESALER' && /company|LLP/i.test(kind || ''))
  const kept = saved?.authorised?.aadhaarLast4

  return (
    <>
      <Card title={`About the ${info.label.toLowerCase()}`} description="From your registration certificate.">
        <Select label="Type of organisation" options={info.entityKinds} {...f('entity.kind')} />
        <Field label="Registration / licence number" optional={proprietor} {...f('entity.registrationNo')} />
        <Field label="Date of registration" type="date" optional={proprietor} max={new Date().toISOString().slice(0, 10)} {...f('entity.registrationDate')} />
        {needsCin && (
          <Field
            label="Corporate Identification Number (CIN)" optional={category !== 'COMPANY'} maxLength={21} hint="21 characters, e.g. U01403TN2019PTC123456"
            value={getIn(value, 'entity.cin')} onChange={(next) => onChange(setIn(value, 'entity.cin', next.toUpperCase()))}
          />
        )}
        {category === 'SOCIETY' && <Field label="Number of members" type="number" min={2} {...f('entity.membersCount')} />}
      </Card>
      {!proprietor && (
        <Card title="Head / secretary / authorised person" description="The person who signs for the organisation.">
          <Field label="Name" {...f('authorised.name')} />
          <Field label="Designation" placeholder="Secretary, President, Director ..." {...f('authorised.designation')} />
          <Field
            label="Aadhaar number" inputMode="numeric" maxLength={14} placeholder={kept ? `Saved: ending ${kept} (leave blank to keep)` : '12 digits'}
            error={aadhaarError(getIn(value, 'authorised.aadhaar'))} {...f('authorised.aadhaar')}
          />
        </Card>
      )}
    </>
  )
}

export function NomineeBankSection({ value, onChange, catalog, regions, saved }) {
  const f = bind(value, onChange)
  const keptAccount = saved?.bank?.accountLast4
  return (
    <>
      <Card title="Nominee" description="Optional. Who the registration passes to.">
        <Field label="Nominee name" optional {...f('nominee.name')} />
        <Field label="Nominee date of birth" type="date" optional max={new Date().toISOString().slice(0, 10)} {...f('nominee.dob')} />
        <Select label="Relationship" optional options={catalog.options.nomineeRelations} {...f('nominee.relation')} />
      </Card>
      <Card title="Bank account" description="Optional, for scheme subsidies and payments from wholesalers. Only the last 4 digits of the account number are stored.">
        <Field label="Account holder name" optional {...f('bank.holderName')} />
        <Field label="Bank name" optional {...f('bank.bankName')} />
        <Field
          label="IFSC code" optional maxLength={11} hint="Like SBIN0001234"
          value={getIn(value, 'bank.ifsc')} onChange={(next) => onChange(setIn(value, 'bank.ifsc', next.toUpperCase()))}
        />
        <Field label="Account number" optional inputMode="numeric" maxLength={18} placeholder={keptAccount ? `Saved: ending ${keptAccount} (leave blank to keep)` : '9 to 18 digits'} {...f('bank.accountNumber')} />
      </Card>
      <Card title="Place of business activity" description="Optional. Only if the bees / business are somewhere other than the address above.">
        <Select label="State" optional options={Object.keys(regions || {})} {...f('business.state')} />
        <Field label="District" optional {...f('business.district')} />
        <TextArea label="Address" optional className="sm:col-span-2" {...f('business.address')} />
      </Card>
    </>
  )
}

// ------------------------------------------------------------------ beekeeping
export function BeekeepingSection({ value, onChange, catalog, regions }) {
  const f = bind(value, onChange)
  const o = catalog.options
  const bee = value.beekeeping || {}
  const training = Array.isArray(bee.training) ? bee.training : []
  const setTraining = (next) => onChange(setIn(value, 'beekeeping.training', next))
  const colonies = Number(bee.colonies)

  return (
    <>
      <Card title="Your bees" description="The National Bee Board registers beekeepers with at least 10 colonies.">
        <Field
          label="Number of bee colonies" type="number" min={10} {...f('beekeeping.colonies')}
          error={bee.colonies !== undefined && bee.colonies !== '' && colonies < 10 ? 'At least 10 colonies are needed to register' : ''}
        />
        <Field label="Years of beekeeping experience" type="number" min={0} max={80} {...f('beekeeping.experienceYears')} />
        <Checks label="Bee species kept" options={o.species} className="sm:col-span-2" {...f('beekeeping.species')} />
        <YesNo label="Do you plan to increase your colonies?" {...f('beekeeping.planIncrease')} />
        {bee.planIncrease && <TextArea label="How many, and how?" {...f('beekeeping.planText')} />}
      </Card>

      <Card title="FPO / cooperative" description="Membership of a Farmer Producer Organisation or cooperative, if any.">
        <YesNo label="Member of an FPO / cooperative?" className="sm:col-span-2" {...f('beekeeping.fpo.member')} />
        {bee.fpo?.member && <>
          <Field label="FPO / cooperative name" {...f('beekeeping.fpo.name')} />
          <Field label="Its registration number" optional {...f('beekeeping.fpo.regNo')} />
          <Field label="Contact number" optional inputMode="numeric" maxLength={10} {...f('beekeeping.fpo.contact')} />
        </>}
      </Card>

      <Card title="Land and migration" description="Where the hives stand, and where you move them for the flowering season.">
        <Select label="Land holding" options={o.landTypes} {...f('beekeeping.land.type')} />
        {bee.land?.type && bee.land.type !== 'Landless' && <>
          <Select label="Land state" optional options={Object.keys(regions || {})} {...f('beekeeping.land.state')} />
          <Field label="Land district" optional {...f('beekeeping.land.district')} />
        </>}
        <Select label="Migration from (month)" optional options={o.months} {...f('beekeeping.migration.from')} />
        <Select label="Migration to (month)" optional options={o.months} {...f('beekeeping.migration.to')} />
        <Field label="Main crop / flowering during migration" optional placeholder="Mustard, litchi, apple ..." {...f('beekeeping.migration.mainCrop')} />
      </Card>

      <section className="rounded-2xl border border-[#d4e9e8] bg-white p-5">
        <h3 className="text-base font-black">Training received</h3>
        <p className="mt-0.5 text-xs text-gray-500">Beekeeping courses you have attended. Add as many as apply, or none.</p>
        <div className="mt-4 grid gap-3">
          {training.map((item, index) => (
            <div key={index} className="grid gap-3 rounded-xl bg-[#f7fbfb] p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <Select label="Programme" options={o.trainingNames} value={item.name} onChange={(next) => setTraining(training.map((row, i) => (i === index ? { ...row, name: next } : row)))} />
              <Select label="Organised by" options={o.trainingOrganisers} value={item.organisedBy} onChange={(next) => setTraining(training.map((row, i) => (i === index ? { ...row, organisedBy: next } : row)))} />
              <button type="button" onClick={() => setTraining(training.filter((_, i) => i !== index))} className="flex items-center justify-center gap-1 rounded-xl border border-gray-200 px-3 py-3 text-xs font-bold text-gray-500 hover:bg-white" aria-label="Remove training">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {training.length < 10 && (
            <button type="button" onClick={() => setTraining([...training, { name: '', organisedBy: '' }])} className="flex w-fit items-center gap-2 rounded-xl border border-dashed border-[#0F766E] px-4 py-2 text-sm font-bold text-[#0F766E]">
              <Plus size={16} /> Add training
            </button>
          )}
        </div>
      </section>
    </>
  )
}

export function ProductionSection({ value, onChange, catalog }) {
  const f = bind(value, onChange)
  const produced = Number(getIn(value, 'production.honeyProducedKg'))
  const sold = Number(getIn(value, 'production.honeySoldKg'))
  const other = catalog.options.otherProducts

  return (
    <>
      <Card title="Last year's honey" description="The previous financial year. Enter 0 if you are just starting.">
        <Field label="Honey produced (kg)" type="number" min={0} {...f('production.honeyProducedKg')} />
        <Field label="Honey sold (kg)" type="number" min={0} error={sold > produced ? 'Cannot be more than produced' : ''} {...f('production.honeySoldKg')} />
        <Field label="Average price per kg (Rs)" type="number" min={0} optional {...f('production.avgPriceKg')} />
        <Checks label="Sold to" optional options={catalog.options.soldTo} {...f('production.soldTo')} />
      </Card>
      <Card title="Colonies and hives" description="Colonies multiplied or sold, and bee boxes made.">
        <Field label="Colonies multiplied" type="number" min={0} optional {...f('production.coloniesMultiplied')} />
        <Field label="Colonies sold" type="number" min={0} optional {...f('production.coloniesSold')} />
        <Field label="Average price per colony (Rs)" type="number" min={0} optional {...f('production.avgPriceColony')} />
        <Field label="Beehives manufactured" type="number" min={0} optional {...f('production.hivesManufactured')} />
        <Field label="Beehives sold" type="number" min={0} optional {...f('production.hivesSold')} />
        <Field label="Average price per beehive (Rs)" type="number" min={0} optional {...f('production.avgPriceHive')} />
      </Card>
      <section className="rounded-2xl border border-[#d4e9e8] bg-white p-5">
        <h3 className="text-base font-black">Other bee products</h3>
        <p className="mt-0.5 text-xs text-gray-500">Leave blank what you do not produce.</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-gray-400"><th className="pb-2">Product</th><th className="pb-2">Produced</th><th className="pb-2">Sold</th><th className="pb-2">Price per unit (Rs)</th></tr></thead>
            <tbody>
              {Object.entries(other).map(([key, item]) => (
                <tr key={key}>
                  <td className="py-1.5 pr-3 font-semibold">{item.label} <span className="text-xs font-normal text-gray-400">({item.unit})</span></td>
                  {['produced', 'sold', 'price'].map((column) => (
                    <td key={column} className="py-1.5 pr-2">
                      <input type="number" min={0} value={getIn(value, `production.other.${key}.${column}`) ?? ''} onChange={(event) => onChange(setIn(value, `production.other.${key}.${column}`, event.target.value))} className="w-full rounded-lg border border-[#c6e2e0] bg-[#f7fbfb] px-3 py-2 outline-none focus:border-[#F97360]" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

export function QualitySection({ value, onChange, catalog }) {
  const f = bind(value, onChange)
  const q = value.quality || {}
  return (
    <>
      <Card title="Disease management and medicines" description="Honey with antibiotic residues fails the lab test. Declaring it here helps your officer advise you.">
        <YesNo label="Any medicines / chemicals used on the bees?" {...f('quality.medicinesUsed')} />
        {q.medicinesUsed ? <TextArea label="Which ones, for what?" {...f('quality.medicinesDetails')} /> : <span />}
        <YesNo label="Any antibiotics used?" {...f('quality.antibioticsUsed')} />
        {q.antibioticsUsed ? <TextArea label="Which antibiotics?" {...f('quality.antibioticDetails')} /> : <span />}
        {q.antibioticsUsed && <>
          <YesNo label="Used under professional supervision?" {...f('quality.professionalSupervision')} />
          <Field label="Dosage" optional {...f('quality.antibioticDosage')} />
        </>}
        {(q.medicinesUsed || q.antibioticsUsed) && <>
          <Field label="Bought from (supplier)" optional {...f('quality.supplier')} />
          <Field label="Withdrawal period followed" optional placeholder="e.g. no honey super for 4 weeks" {...f('quality.withdrawalPeriod')} />
        </>}
      </Card>
      <Card title="Records and equipment">
        <YesNo label="Do you keep apiary records?" {...f('quality.recordsMaintained')} />
        <YesNo label="Purchase bills for medicines available?" {...f('quality.purchaseBillsAvailable')} />
        <YesNo label="Food-grade extraction and storage equipment?" {...f('quality.qualityEquipment')} />
        <span />
        <Field label="Number of honey containers" type="number" min={0} optional {...f('quality.containers.count')} />
        <Field label="Capacity of each (kg)" type="number" min={0} optional {...f('quality.containers.capacityKg')} />
        <Select label="Container type" optional options={catalog.options.containerTypes} {...f('quality.containers.type')} />
      </Card>
    </>
  )
}

// ------------------------------------------------------------------ wholesaler
export function TradeSection({ value, onChange, catalog }) {
  const f = bind(value, onChange)
  const o = catalog.options
  return (
    <>
      <Card title="Your trade" description="What the National Bee Board asks of wholesalers, traders and packers.">
        <Select label="Business type" options={o.businessTypes} {...f('trade.businessType')} />
        <Field label="Trade licence number" {...f('trade.tradeLicenceNo')} />
        <Select label="FSSAI licence category" optional options={['Basic registration', 'State licence', 'Central licence']} {...f('trade.fssaiCategory')} />
        <Field label="Brand name" optional {...f('trade.brandName')} />
        <Field
          label="Import Export Code (IEC)" optional hint="Exporters only, 10 characters" maxLength={10}
          value={getIn(value, 'trade.iec')} onChange={(next) => onChange(setIn(value, 'trade.iec', next.toUpperCase()))}
        />
        <Field label="APEDA registration number" optional hint="Exporters only" {...f('trade.apedaNo')} />
      </Card>
      <Card title="Capacity and warehouse">
        <Field label="Storage capacity (kg)" type="number" min={100} {...f('trade.storageCapacityKg')} />
        <Field label="Monthly purchase capacity (kg)" type="number" min={50} {...f('trade.monthlyPurchaseKg')} />
        <TextArea label="Warehouse / godown address" className="sm:col-span-2" {...f('trade.warehouseAddress')} />
      </Card>
      <Card title="What you buy and how you pack it">
        <Checks label="States you buy honey from" options={o.sourcingStates} className="sm:col-span-2" {...f('trade.sourcingStates')} />
        <Checks label="Packaging you use" optional options={o.packagingTypes} className="sm:col-span-2" {...f('trade.packagingTypes')} />
        <Checks label="Honey types you are looking for" optional options={o.honeyTypes.slice(0, 24)} className="sm:col-span-2" {...f('trade.honeyTypes')} />
        <TextArea label="Anything beekeepers should know" optional className="sm:col-span-2" placeholder="e.g. we buy lab-verified multifloral honey in 30 kg food-grade cans" {...f('trade.preferredSellers')} />
      </Card>
    </>
  )
}

// Every section that applies to a category, in form order (the "Registration details" editor).
export function ProfileForm({ category, value, onChange, catalog, regions, saved }) {
  const props = { category, value, onChange, catalog, regions, saved }
  const producer = catalog.categories[category]?.producer
  return (
    <div className="grid gap-5">
      <ApplicantSection {...props} />
      <EntitySection {...props} />
      <NomineeBankSection {...props} />
      {producer ? <>
        <BeekeepingSection {...props} />
        <ProductionSection {...props} />
        <QualitySection {...props} />
      </> : <TradeSection {...props} />}
    </div>
  )
}

// Quick checks for one wizard step, so the obvious gaps show before the server is asked. Returns a message or ''.
export function checkStep(step, category, value) {
  const individual = category === 'INDIVIDUAL'
  const g = (path) => getIn(value, path)
  const blank = (path) => g(path) === undefined || g(path) === null || String(g(path)).trim() === ''
  if (step === 'identity') {
    const proprietor = category === 'WHOLESALER' && g('entity.kind') === 'Proprietorship'
    if (individual && (blank('applicant.fatherHusbandName') || blank('applicant.dob') || blank('applicant.gender') || blank('applicant.education'))) return "Fill in the father's / husband's name, date of birth, gender and education."
    if ((individual || proprietor) && !validAadhaar(g('applicant.aadhaar'))) return 'Enter a valid 12-digit Aadhaar number.'
    if (!individual && !/^[A-Z]{5}\d{4}[A-Z]$/.test(g('applicant.pan') || '')) return 'Enter the PAN (like ABCDE1234F).'
    if (!individual) {
      if (blank('entity.kind')) return 'Choose the type of organisation.'
      if (!proprietor && (blank('entity.registrationNo') || blank('entity.registrationDate'))) return 'Enter the registration number and date.'
      if (category === 'COMPANY' && !/^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/.test(g('entity.cin') || '')) return 'Enter the 21-character CIN.'
      if (category === 'SOCIETY' && !(Number(g('entity.membersCount')) >= 2)) return 'Enter the number of members.'
      if (!proprietor && (blank('authorised.name') || blank('authorised.designation') || !validAadhaar(g('authorised.aadhaar')))) return "Fill in the authorised person's name, designation and Aadhaar number."
    }
  }
  if (step === 'bees') {
    if (!(Number(g('beekeeping.colonies')) >= 10)) return 'At least 10 bee colonies are needed to register.'
    if (!(g('beekeeping.species') || []).length) return 'Choose the bee species you keep.'
    if (blank('beekeeping.experienceYears')) return 'Enter your years of beekeeping experience.'
    if (blank('beekeeping.land.type')) return 'Choose your land holding.'
    if ((g('beekeeping.training') || []).some((item) => !item.name || !item.organisedBy)) return 'Complete or remove each training row.'
  }
  if (step === 'production') {
    if (blank('production.honeyProducedKg')) return "Enter last year's honey production (0 if you are just starting)."
    if (Number(g('production.honeySoldKg') || 0) > Number(g('production.honeyProducedKg'))) return 'Honey sold cannot be more than honey produced.'
  }
  if (step === 'trade') {
    if (blank('trade.businessType') || blank('trade.tradeLicenceNo')) return 'Choose the business type and enter the trade licence number.'
    if (!(Number(g('trade.storageCapacityKg')) >= 100) || !(Number(g('trade.monthlyPurchaseKg')) >= 50)) return 'Enter the storage (100 kg or more) and monthly purchase (50 kg or more) capacity.'
    if (String(g('trade.warehouseAddress') || '').trim().length < 10) return 'Enter the warehouse / godown address.'
    if (!(g('trade.sourcingStates') || []).length) return 'Choose the states you buy honey from.'
  }
  return ''
}
