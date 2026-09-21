import { useCallback, useEffect, useRef, useState } from 'react'
import { API_URL, useLang } from './i18n'

// Accepts a jar ID, a batch number, or a whole QR link, and works out which it is.
export function parseCode(input) {
  const text = String(input || '').trim()
  if (!text) return null

  try {
    const url = new URL(text)
    const pack = url.searchParams.get('pack_id')
    const batch = url.searchParams.get('batch')
    if (pack) return { pack }
    if (batch) return { batch }
  } catch { /* not a URL */ }

  return /^PB-/i.test(text) ? { pack: text } : { batch: text.toUpperCase() }
}

const dateOf = (value, lang) => {
  if (!value) return ''
  const text = String(value)
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00` : /^\d{4}-\d{2}-\d{2} \d/.test(text) ? `${text.replace(' ', 'T')}Z` : text)
  return Number.isNaN(date.getTime()) ? text : date.toLocaleDateString(`${lang}-IN`, { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function VerifyPanel({ initial }) {
  const { t, lang } = useLang()
  const v = t.verify
  const [input, setInput] = useState(initial?.pack || initial?.batch || '')
  const [state, setState] = useState({ record: null, error: '', loading: false })
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState('')
  const video = useRef(null)
  const scanTimer = useRef(0)

  const lookup = useCallback(async (raw) => {
    const code = parseCode(raw)
    if (!code) return

    setState({ record: null, error: '', loading: true })
    const query = code.pack ? `pack_id=${encodeURIComponent(code.pack)}` : `batch=${encodeURIComponent(code.batch)}`

    try {
      const response = await fetch(`${API_URL}/verify?${query}`)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(response.status === 404 ? 'NOT_FOUND' : 'FAILED')
      setState({ record: payload, error: '', loading: false })
    } catch (error) {
      setState({ record: null, error: error.message === 'NOT_FOUND' ? v.notFound : v.failed, loading: false })
    }
  }, [v.failed, v.notFound])

  useEffect(() => { if (initial?.pack || initial?.batch) lookup(initial.pack || initial.batch) }, [initial, lookup])

  const stopScan = useCallback(() => {
    window.clearInterval(scanTimer.current)
    video.current?.srcObject?.getTracks().forEach((track) => track.stop())
    setScanning(false)
  }, [])

  useEffect(() => stopScan, [stopScan])

  async function startScan() {
    setScanError('')

    if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
      setScanError(v.noScan)
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      setScanning(true)
      await new Promise((resolve) => window.setTimeout(resolve, 50))
      video.current.srcObject = stream
      await video.current.play()

      const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
      scanTimer.current = window.setInterval(async () => {
        try {
          const [hit] = await detector.detect(video.current)
          if (hit?.rawValue) {
            stopScan()
            setInput(hit.rawValue)
            lookup(hit.rawValue)
          }
        } catch { /* keep scanning */ }
      }, 350)
    } catch {
      setScanError(v.noScan)
      setScanning(false)
    }
  }

  const { record, error, loading } = state

  return (
    <div className="verify-panel">
      <form className="verify-form" onSubmit={(event) => { event.preventDefault(); lookup(input) }}>
        <input value={input} onChange={(event) => setInput(event.target.value)} placeholder={v.placeholder} aria-label={v.button} />
        <button className="btn-gold" type="submit">{v.button}</button>
        <button className="btn-ghost" type="button" onClick={scanning ? stopScan : startScan}>{scanning ? v.stopScan : v.scan}</button>
      </form>

      {scanning && (
        <div className="scanner">
          <video ref={video} playsInline muted />
          <p>{v.scanning}</p>
        </div>
      )}
      {scanError && <p className="verify-note">{scanError}</p>}
      {loading && <p className="verify-note">{v.checking}</p>}
      {error && <div className="verdict bad"><h3>{error}</h3><button className="btn-ghost dark" onClick={() => setState({ record: null, error: '', loading: false })}>{v.another}</button></div>}
      {record && <Result record={record} lang={lang} v={v} />}
    </div>
  )
}

function Result({ record, lang, v }) {
  const verdict = v.verdicts[record.authenticity] || v.verdicts.UNDER_REVIEW
  const tone = record.authenticity === 'VALID' ? 'good' : record.authenticity === 'NOT_CERTIFIED' ? 'warn' : 'bad'
  const batchLevel = record.scope === 'BATCH'
  const L = v.labels

  return (
    <div className="result">
      <div className={`verdict ${tone}`}>
        <span className="verdict-mark">{tone === 'good' ? '✓' : '!'}</span>
        <div>
          <p className="verdict-code">{record.authenticity.replace('_', ' ')}</p>
          <h3>{verdict.title}</h3>
          <p>{verdict.reason}</p>
        </div>
      </div>

      <div className="result-grid">
        <Card title={v.sections.product}>
          <Row label={L.product} value={record.product.name ? `${record.product.name} · ${record.product.jarSizeGrams} g` : record.product.honeyType} />
          <Row label={L.honeyType} value={record.product.honeyType} />
          <Row label={L.batch} value={record.product.batchCode} />
          <Row label={L.harvested} value={dateOf(record.product.harvestDate, lang)} />
          {batchLevel
            ? <><Row label={L.quantity} value={`${record.product.quantityKg} kg`} /><Row label={L.bottles} value={record.product.bottles} /></>
            : <Row label={L.jar} value={record.product.packId} mono />}
        </Card>

        {record.producer && (
          <Card title={v.sections.producer}>
            <Row label={L.producer} value={record.producer.name} />
            <Row label={L.origin} value={`${record.producer.region}, ${record.producer.state}`} />
            <Row label={L.fssai} value={record.producer.fssaiLicense} />
            {record.producer.closed && <Row label={L.closed} value={L.closedValue} />}
          </Card>
        )}

        <Card title={v.sections.lab}>
          {record.laboratory ? (
            <>
              <Row label={L.laboratory} value={record.laboratory.labName} />
              <Row label={L.certificate} value={`${record.laboratory.certificateReference} · ${record.laboratory.outcome}`} />
              <Row label={L.tested} value={dateOf(record.laboratory.testedAt, lang)} />
              <Row label={L.moisture} value={record.laboratory.results.moisturePercent != null ? `${record.laboratory.results.moisturePercent} %` : '—'} />
              <Row label={L.hmf} value={record.laboratory.results.hmfMgPerKg != null ? `${record.laboratory.results.hmfMgPerKg} mg/kg` : '—'} />
              <Row label={L.antibiotics} value={record.laboratory.results.antibiotics === 'NOT_DETECTED' ? L.notDetected : record.laboratory.results.antibiotics || '—'} />
            </>
          ) : <p className="muted">{v.noLab}</p>}
        </Card>

        <Card title={v.sections.approval}>
          {record.approval ? (
            <>
              <div className={`sigline ${record.approval.signatureValid ? 'good' : 'bad'}`}>{record.approval.signatureValid ? v.signatureValid : v.signatureInvalid}</div>
              <Row label={L.approvedBy} value={record.approval.officerName} />
              <Row label={L.designation} value={record.approval.designation} />
              <Row label={L.signed} value={dateOf(record.approval.signedAt, lang)} />
              <Row label={L.key} value={record.approval.keyFingerprint} mono />
            </>
          ) : <p className="muted">{v.noApproval}</p>}
        </Card>

        <Card title={v.sections.history} wide>
          <ol className="timeline">
            {record.timeline.map((event) => (
              <li key={event.id}>
                <b>{v.events[event.type] || event.label}{event.scope === 'THIS_JAR' ? ` (${v.thisJar})` : ''}</b>
                <small>{dateOf(event.at, lang)} · {L.block} #{event.blockHeight}</small>
              </li>
            ))}
          </ol>
        </Card>

        <Card title={v.sections.chain} wide>
          <ol className="journey">
            {record.supplyChain.map((step, index) => (
              <li key={`${step.stage}-${index}`} className={step.stage === 'CONSUMER' ? 'last' : ''}>
                <b>{v.stages[step.stage] || step.label}</b>
                <small>{step.stage === 'CONSUMER' ? v.youScanned : `${step.name}${step.quantityKg ? ` · ${step.quantityKg} kg` : ''}`}</small>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <ChainProof record={record} lang={lang} />

      <p className="verify-note small">
        {record.ledger.valid ? `${v.chainOk} · ${record.ledger.blocks} ${v.blocks} · ${record.ledger.transactions} ${v.records}.` : `${v.chainBad}.`} {v.privacy}
      </p>
    </div>
  )
}

const PROOF = {
  en: { title: 'Smart-contract proof (Polygon-compatible EVM chain)', contract: 'Contract', chain: 'Chain ID', registered: 'Batch registered on chain (harvester signature)', certified: 'Certified on chain (officer signature, second signer)', jars: 'Jar lot recorded (Merkle root)', jarProof: 'This jar is proven by the contract', anchor: 'Audit-ledger head anchored', tx: 'Transaction', block: 'Block', cid: 'Public metadata (IPFS CID)', checking: 'Checking the smart contract…', offline: 'The chain could not be reached right now. The records above are still verified against the audit ledger.', live: 'Live read from the contract' },
  hi: { title: 'स्मार्ट-कॉन्ट्रैक्ट प्रमाण (पॉलीगॉन-संगत EVM चेन)', contract: 'कॉन्ट्रैक्ट', chain: 'चेन ID', registered: 'बैच चेन पर पंजीकृत (उत्पादक का हस्ताक्षर)', certified: 'चेन पर प्रमाणित (अधिकारी का हस्ताक्षर, दूसरा हस्ताक्षरकर्ता)', jars: 'जार लॉट दर्ज (मर्कल रूट)', jarProof: 'यह जार कॉन्ट्रैक्ट द्वारा प्रमाणित है', anchor: 'ऑडिट-लेजर का शीर्ष एंकर किया गया', tx: 'लेनदेन', block: 'ब्लॉक', cid: 'सार्वजनिक मेटाडेटा (IPFS CID)', checking: 'स्मार्ट कॉन्ट्रैक्ट जाँचा जा रहा है…', offline: 'अभी चेन तक नहीं पहुँचा जा सका। ऊपर के रिकॉर्ड फिर भी ऑडिट लेजर से सत्यापित हैं।', live: 'कॉन्ट्रैक्ट से लाइव पढ़ा गया' },
}

const short = (hash) => (hash ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : '—')

// Reads the smart contract live and shows the transactions behind this jar or batch.
function ChainProof({ record, lang }) {
  const L = PROOF[lang] || PROOF.en
  const [proof, setProof] = useState(null)
  const query = record.product.packId ? `pack_id=${encodeURIComponent(record.product.packId)}` : `batch=${encodeURIComponent(record.product.batchCode)}`

  useEffect(() => {
    let alive = true
    fetch(`${API_URL}/verify/onchain?${query}`).then((response) => response.json()).then((data) => { if (alive) setProof(data) }).catch(() => { if (alive) setProof({ enabled: false }) })
    return () => { alive = false }
  }, [query])

  if (!proof) return <p className="verify-note small">{L.checking}</p>
  if (!proof.enabled || !proof.contract) return null

  const step = (ok, label, txInfo) => (
    <li className={ok ? '' : 'last'}>
      <b>{ok ? '✔' : '·'} {label}</b>
      {txInfo?.tx_hash && <small>{L.tx} {proof.explorer ? <a className="mono" href={`${proof.explorer}/tx/${txInfo.tx_hash}`} target="_blank" rel="noopener noreferrer">{short(txInfo.tx_hash)}</a> : <span className="mono">{short(txInfo.tx_hash)}</span>} · {L.block} #{txInfo.block_number}</small>}
    </li>
  )

  return (
    <Card title={L.title} wide>
      <div>
        <Row label={L.contract} value={proof.explorer ? <a href={`${proof.explorer}/address/${proof.contract}`} target="_blank" rel="noopener noreferrer">{short(proof.contract)}</a> : short(proof.contract)} mono />
        <Row label={L.chain} value={proof.chainId} />
        {proof.live?.metadataCid && <Row label={L.cid} value={<a href={`${API_URL}/ipfs/${proof.live.metadataCid}`} target="_blank" rel="noopener noreferrer">{short(proof.live.metadataCid)}</a>} mono />}
      </div>
      <ol className="journey" style={{ marginTop: 12 }}>
        {step(proof.live ? proof.live.registered : Boolean(proof.batch.registered), L.registered, proof.batch.registered)}
        {step(proof.live ? proof.live.certified && proof.live.passed : Boolean(proof.batch.certified), L.certified, proof.batch.certified)}
        {proof.jars && step(proof.live?.jarProven ?? true, record.product.packId ? L.jarProof : L.jars, proof.jars)}
        {proof.anchor && step(true, `${L.anchor} (#${proof.anchor.height})`, { tx_hash: proof.anchor.tx, block_number: proof.anchor.block })}
      </ol>
      <p className="verify-note small">{proof.live && !proof.live.error ? L.live : L.offline}</p>
    </Card>
  )
}

function Card({ title, children, wide }) {
  return <section className={`rcard ${wide ? 'wide' : ''}`}><h4>{title}</h4>{children}</section>
}

function Row({ label, value, mono }) {
  return <div className="rrow"><span>{label}</span><b className={mono ? 'mono' : ''}>{value ?? '—'}</b></div>
}
