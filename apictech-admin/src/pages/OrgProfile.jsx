import { CATEGORY_LABELS, StatusPill, fmtDate, inr } from '../ui'

// The registration details a company declared (Madhukranti-style form, services/registrationProfile.js), as the
// officer reviewing it sees them. Aadhaar and bank account numbers are kept as their last 4 digits only.

const list = (items) => (Array.isArray(items) && items.length ? items.join(', ') : '—')
const yesNo = (value) => (value === true ? 'Yes' : value === false ? 'No' : '—')

function Row({ label, value }) {
  return <div><span>{label}</span><strong>{value === undefined || value === null || value === '' ? '—' : value}</strong></div>
}

export function CategoryTag({ category, sample }) {
  if (!category) return null
  return <em className={`status ${category === 'WHOLESALER' ? 'violet' : 'blue'}`} title={sample ? 'Sample details filled in for demonstration' : 'How the company registered'}>{CATEGORY_LABELS[category] || category}{sample ? ' · sample' : ''}</em>
}

export default function OrgProfile({ profile }) {
  if (!profile) return <p className="note">No registration details on file.</p>
  const { applicant = {}, entity, authorised, nominee, bank, business, beekeeping, production, quality, trade } = profile
  const other = production?.other || {}

  return (
    <>
      {profile.sample && <p className="note" style={{ color: '#b45309' }}>These details are a made-up sample: this company registered before the full registration form existed (or is a demo company). The keeper can replace them in Settings.</p>}

      <h4 className="subsection-title">Applicant</h4>
      <div className="kv-grid">
        <Row label="Registered as" value={CATEGORY_LABELS[profile.category] || profile.category} />
        <Row label="Name" value={applicant.name} />
        <Row label="Father's / husband's name" value={applicant.fatherHusbandName} />
        <Row label="Date of birth" value={applicant.dob ? fmtDate(applicant.dob) : ''} />
        <Row label="Gender · education" value={[applicant.gender, applicant.education].filter(Boolean).join(' · ')} />
        <Row label="Social category" value={applicant.socialCategory} />
        {applicant.aadhaarLast4 && <Row label="Aadhaar" value={`XXXX XXXX ${applicant.aadhaarLast4}`} />}
        <Row label="PAN" value={applicant.pan} />
        {applicant.altPhone && <Row label="Alternate mobile" value={applicant.altPhone} />}
      </div>

      {entity && <>
        <h4 className="subsection-title">Organisation</h4>
        <div className="kv-grid">
          <Row label="Type" value={entity.kind} />
          <Row label="Registration no." value={entity.registrationNo} />
          <Row label="Registered on" value={entity.registrationDate ? fmtDate(entity.registrationDate) : ''} />
          {entity.cin && <Row label="CIN" value={entity.cin} />}
          {entity.membersCount && <Row label="Members" value={entity.membersCount} />}
          {authorised && <Row label="Authorised person" value={`${authorised.name}, ${authorised.designation}`} />}
          {authorised?.aadhaarLast4 && <Row label="Their Aadhaar" value={`XXXX XXXX ${authorised.aadhaarLast4}`} />}
        </div>
      </>}

      {(nominee || bank || business) && <>
        <h4 className="subsection-title">Nominee, bank, place of business</h4>
        <div className="kv-grid">
          {nominee && <Row label="Nominee" value={`${nominee.name} (${nominee.relation})`} />}
          {bank && <Row label="Bank · IFSC" value={`${bank.bankName} · ${bank.ifsc}`} />}
          {bank && <Row label="Account" value={`${bank.holderName || ''} · XXXX${bank.accountLast4}`} />}
          {business && <Row label="Business activity at" value={[business.address, business.district, business.state].filter(Boolean).join(', ')} />}
        </div>
      </>}

      {beekeeping && <>
        <h4 className="subsection-title">Bees and training</h4>
        <div className="kv-grid">
          <Row label="Colonies" value={beekeeping.colonies} />
          <Row label="Species" value={list(beekeeping.species)} />
          <Row label="Experience" value={`${beekeeping.experienceYears} years`} />
          <Row label="Plans to expand" value={beekeeping.planIncrease ? beekeeping.planText : 'No'} />
          <Row label="FPO / cooperative" value={beekeeping.fpo?.member ? `${beekeeping.fpo.name}${beekeeping.fpo.regNo ? ` (${beekeeping.fpo.regNo})` : ''}` : 'Not a member'} />
          <Row label="Land" value={[beekeeping.land?.type, beekeeping.land?.district, beekeeping.land?.state].filter(Boolean).join(', ')} />
          <Row label="Migration" value={beekeeping.migration ? `${beekeeping.migration.from} → ${beekeeping.migration.to}${beekeeping.migration.mainCrop ? ` (${beekeeping.migration.mainCrop})` : ''}` : 'Stationary'} />
          <Row label="Training" value={(beekeeping.training || []).length ? beekeeping.training.map((item) => `${item.name} (${item.organisedBy})`).join('; ') : 'None'} />
        </div>
      </>}

      {production && <>
        <h4 className="subsection-title">Last year's production</h4>
        <div className="kv-grid">
          <Row label="Honey produced · sold" value={`${production.honeyProducedKg} kg · ${production.honeySoldKg} kg`} />
          <Row label="Average price" value={production.avgPriceKg ? `${inr(production.avgPriceKg)}/kg` : ''} />
          <Row label="Sold to" value={list(production.soldTo)} />
          <Row label="Colonies multiplied · sold" value={`${production.coloniesMultiplied} · ${production.coloniesSold}`} />
          <Row label="Beehives made · sold" value={`${production.hivesManufactured} · ${production.hivesSold}`} />
          <Row label="Other bee products" value={Object.keys(other).length ? Object.entries(other).map(([key, item]) => `${key} ${item.produced}`).join(', ') : 'None'} />
        </div>
      </>}

      {quality && <>
        <h4 className="subsection-title">Disease management</h4>
        <div className="kv-grid">
          <Row label="Medicines" value={quality.medicinesUsed ? quality.medicinesDetails : 'None'} />
          <Row label="Antibiotics" value={quality.antibioticsUsed ? `${quality.antibioticDetails}${quality.professionalSupervision ? ' (supervised)' : ' (NOT supervised)'}` : 'None'} />
          {quality.withdrawalPeriod && <Row label="Withdrawal period" value={quality.withdrawalPeriod} />}
          <Row label="Records · bills · equipment" value={`${yesNo(quality.recordsMaintained)} · ${yesNo(quality.purchaseBillsAvailable)} · ${yesNo(quality.qualityEquipment)}`} />
          <Row label="Containers" value={quality.containers?.count ? `${quality.containers.count} × ${quality.containers.capacityKg} kg ${quality.containers.type || ''}` : ''} />
        </div>
      </>}

      {trade && <>
        <h4 className="subsection-title">Trade</h4>
        <div className="kv-grid">
          <Row label="Business type" value={trade.businessType} />
          <Row label="Trade licence" value={trade.tradeLicenceNo} />
          <Row label="FSSAI category" value={trade.fssaiCategory} />
          {trade.brandName && <Row label="Brand" value={trade.brandName} />}
          {trade.iec && <Row label="IEC" value={trade.iec} />}
          <Row label="Storage · monthly purchase" value={`${Number(trade.storageCapacityKg).toLocaleString('en-IN')} kg · ${Number(trade.monthlyPurchaseKg).toLocaleString('en-IN')} kg`} />
          <Row label="Warehouse" value={trade.warehouseAddress} />
          <Row label="Buys from" value={list(trade.sourcingStates)} />
          <Row label="Packaging" value={list(trade.packagingTypes)} />
        </div>
      </>}
    </>
  )
}

// Wholesale offers the company made (a wholesaler) or received (a beekeeper).
export function TradeActivity({ trade }) {
  if (!trade || trade.offers.length === 0) return <p className="note">No wholesale offers yet.</p>
  return (
    <>
      <p className="note">Accepted: {trade.acceptedKg} kg worth {inr(trade.acceptedValueInr)}.</p>
      <div className="table-scroll">
        <table className="dtable">
          <thead><tr><th>Offer</th><th>{trade.role === 'BUYER' ? 'Beekeeper' : 'Wholesaler'}</th><th>Honey</th><th className="num">Kg</th><th className="num">Rs/kg</th><th>Status</th><th>Date</th></tr></thead>
          <tbody>{trade.offers.map((offer) => (
            <tr key={offer.code}>
              <td><strong>{offer.code}</strong><br /><small>{offer.batchCode}</small></td><td>{offer.otherParty}</td><td>{offer.honeyType}</td>
              <td className="num">{offer.quantityKg}</td><td className="num">{offer.offerPricePerKg}</td><td><StatusPill status={offer.status} /></td><td>{fmtDate(offer.createdAt)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>
  )
}
