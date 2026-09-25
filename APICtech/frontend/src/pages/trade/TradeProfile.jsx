import TradeLayout, { useTradeSummary } from '../../layouts/TradeLayout'
import RegistrationDetails from '../../components/registration/RegistrationDetails'

// The wholesaler's company record: GST / FSSAI / NBB numbers, the registration details and documents, and the
// KVIC offices that look after it.
export default function TradeProfile() {
  const trade = useTradeSummary()
  const org = trade.summary?.organization
  const offices = trade.summary?.offices

  const info = (label, value) => (
    <div className="rounded-xl bg-[#f4fbfb] px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#5d7f80]">{label}</p>
      <p className="mt-1 break-words text-sm font-bold">{value || '—'}</p>
    </div>
  )

  return (
    <TradeLayout title="Profile" trade={trade}>
      {org && (
        <div className="grid gap-6">
          <section className="rounded-2xl border border-[#c0dfdd] bg-white p-6">
            <h3 className="text-lg font-black">Company</h3>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {info('Name', org.name)}
              {info('Company code', org.code)}
              {info('Status', org.status === 'APPROVED' ? `Approved ${org.reviewedAt ? `on ${new Date(org.reviewedAt).toLocaleDateString('en-IN')}` : ''}` : org.status)}
              {info('NBB trader / packer number', org.registrationNo)}
              {info('GSTIN', org.gstin)}
              {info('FSSAI licence', org.fssai)}
              {info('State', org.state)}
              {info('KVIC region', org.region)}
            </div>
          </section>
          <section className="rounded-2xl border border-[#c0dfdd] bg-white p-6"><RegistrationDetails /></section>
          {offices && (
            <section className="rounded-2xl border border-[#c0dfdd] bg-white p-6">
              <h3 className="text-lg font-black">Your KVIC offices</h3>
              <div className="mt-4 grid gap-2">
                {[offices.regional, offices.state, offices.central].filter(Boolean).map((office) => (
                  <div key={office.level} className="rounded-xl bg-[#f4fbfb] px-4 py-3">
                    <p className="text-sm font-bold">{office.name}</p>
                    <p className="mt-1 text-sm text-gray-600">{office.address}</p>
                    {office.email && <p className="mt-1 text-xs text-gray-500">{office.email}{office.sample ? ' (sample address)' : ''}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </TradeLayout>
  )
}
