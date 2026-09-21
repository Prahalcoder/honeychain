import db from '../database/database.js'

// AI-assisted laboratory review. The analysis highlights values and anomalies
// for the regional officer; it never approves anything. The current engine is a
// deterministic rule set over reference limits for honey (FSSAI-based). The
// limits below are configuration: confirm them against the current standard.
export const LIMITS = {
  moisturePercent: { max: 20, warnFrom: 18, unit: '%', label: 'Moisture', hint: 'Above the limit honey can ferment; close to it is a storage risk.' },
  hmfMgPerKg: { max: 80, warnFrom: 40, unit: 'mg/kg', label: 'HMF (hydroxymethylfurfural)', hint: 'High HMF suggests heating, long storage or adulteration with invert syrup.' },
  sucrosePercent: { max: 5, warnFrom: 4, unit: '%', label: 'Sucrose', hint: 'High sucrose can indicate sugar adulteration.' },
}

const DAY = 24 * 60 * 60 * 1000

export async function analyzeLabResult({ results = {}, declaredStatus, testedAt, harvestDate, certificateReference, batchId }) {
  const findings = []
  const anomalies = []

  for (const [key, spec] of Object.entries(LIMITS)) {
    const value = results[key]

    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      findings.push({ parameter: spec.label, value: null, limit: `≤ ${spec.max} ${spec.unit}`, status: 'MISSING', note: 'Not reported on the certificate.' })
      continue
    }

    const number = Number(value)
    const status = number > spec.max ? 'FAIL' : number >= spec.warnFrom ? 'WARNING' : 'OK'

    findings.push({
      parameter: spec.label,
      value: `${number} ${spec.unit}`,
      limit: `≤ ${spec.max} ${spec.unit}`,
      status,
      note: status === 'FAIL' ? `Exceeds the limit. ${spec.hint}` : status === 'WARNING' ? `Close to the limit. ${spec.hint}` : 'Within the limit.',
    })
  }

  const antibiotics = results.antibiotics
  findings.push(
    antibiotics === 'DETECTED'
      ? { parameter: 'Antibiotic residue', value: 'Detected', limit: 'Not detected', status: 'FAIL', note: 'Residues are not permitted in honey.' }
      : antibiotics === 'NOT_DETECTED'
        ? { parameter: 'Antibiotic residue', value: 'Not detected', limit: 'Not detected', status: 'OK', note: 'No residue reported.' }
        : { parameter: 'Antibiotic residue', value: null, limit: 'Not detected', status: 'MISSING', note: 'Not reported on the certificate.' },
  )

  const failing = findings.filter((finding) => finding.status === 'FAIL')
  const warnings = findings.filter((finding) => finding.status === 'WARNING')
  const missing = findings.filter((finding) => finding.status === 'MISSING')

  if (declaredStatus === 'PASSED' && failing.length > 0) {
    anomalies.push(`The certificate says PASSED, but ${failing.map((finding) => finding.parameter).join(', ')} is outside the reference limit.`)
  }

  if (declaredStatus === 'FAILED' && failing.length === 0 && missing.length === 0) {
    anomalies.push('The certificate says FAILED, but every reported value is within the reference limits.')
  }

  const tested = testedAt ? new Date(testedAt).getTime() : null
  const harvested = harvestDate ? new Date(harvestDate).getTime() : null

  if (tested && harvested && tested < harvested) {
    anomalies.push('The test date is earlier than the harvest date of this batch.')
  } else if (tested && harvested && tested - harvested > 90 * DAY) {
    anomalies.push('The sample was tested more than 90 days after harvest; the result may not represent the current batch.')
  }

  if (certificateReference) {
    const reused = await db.prepare(`
      SELECT b.batch_code FROM laboratory_tests t
      JOIN batches b ON b.id = t.batch_id
      WHERE lower(t.certificate_reference) = lower(?) AND t.batch_id != ?
      LIMIT 1
    `).get(certificateReference, batchId ?? -1)

    if (reused) anomalies.push(`This certificate number was already used for batch ${reused.batch_code}. A certificate normally covers one batch.`)
  }

  if (missing.length > 0) anomalies.push(`${missing.length} expected value(s) are missing from the certificate.`)

  const riskLevel = failing.length > 0 || anomalies.some((line) => /already used|earlier than/.test(line)) ? 'HIGH'
    : warnings.length > 0 || anomalies.length > 0 ? 'MEDIUM'
      : 'LOW'

  const attention = [
    ...failing.map((finding) => `${finding.parameter}: ${finding.value} against ${finding.limit}`),
    ...anomalies,
    ...warnings.map((finding) => `${finding.parameter} is close to its limit (${finding.value}).`),
  ]

  return {
    engine: 'rule-based-v1',
    standard: 'FSSAI-based reference limits (configurable)',
    riskLevel,
    summary: riskLevel === 'LOW'
      ? 'All reported values are within the reference limits and no anomalies were found. The officer still decides.'
      : `${attention.length} point(s) need the officer's attention before this certificate is approved.`,
    findings,
    anomalies,
    attention,
    disclaimer: 'Decision support only. The regional officer approves or rejects the certificate.',
  }
}
