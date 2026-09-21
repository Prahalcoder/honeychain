import { useEffect, useState } from 'react'
import { AlertTriangle, Blocks, ChevronRight, Fingerprint, Search, ShieldCheck } from 'lucide-react'

import { api, session, useLive } from '../api'
import { Empty, LiveBadge, Modal, PageIntro, StatusPill, fmtDate, fmtDateTime, kg, num, shortHash } from '../ui'

const ENTITY_TYPES = ['BATCH', 'PACK_BATCH', 'PACK', 'ORGANIZATION']

// Shared blockchain explorer for regional, state and national officers.
export default function Chain({ params }) {
  const [tab, setTab] = useState(params.tab || 'blocks')
  const [orgId, setOrgId] = useState(params.orgId || null)
  const [batchCode, setBatchCode] = useState(params.batchCode || null)
  const [blockHeight, setBlockHeight] = useState(null)
  const summary = useLive('/admin/chain/summary', { interval: 5000 })
  const [verifying, setVerifying] = useState(false)
  const [verification, setVerification] = useState(null)

  async function verifyNow() {
    setVerifying(true)
    try { setVerification(await api('/admin/chain/validate', { method: 'POST' })) } finally { setVerifying(false) }
  }

  const info = summary.data
  const integrity = verification || info?.integrity
  const intact = integrity?.valid !== false

  return (
    <>
      <PageIntro
        eyebrow="Shared secure ledger"
        title="Blockchain"
        copy="Harvests, lab verifications, bottle QR codes and officer decisions, sealed into validator-signed blocks. Only identifiers are stored here; company books stay private."
        right={<LiveBadge updatedAt={summary.updatedAt} error={summary.error} />}
      />

      {info && (
        <section className={`panel chain-hero ${intact ? '' : 'broken'}`}>
          <div className="ledger-status">
            <span className="ledger-check">{intact ? <ShieldCheck size={29} /> : <AlertTriangle size={29} />}</span>
            <div>
              <p className="eyebrow">{intact ? 'Integrity verified' : `Integrity broken: ${integrity.reason}${integrity.brokenAt ? ` at #${integrity.brokenAt}` : ''}`}</p>
              <h2>Block #{info.height} is the chain head</h2>
              <div className="chain-facts">
                <div><span>Transactions</span><strong>{num(info.events)}</strong></div>
                <div><span>Head hash</span><strong className="mono">{shortHash(info.headHash)}</strong></div>
                <div><span>Validator</span><strong>{info.validator.id} · ed25519</strong></div>
              </div>
            </div>
          </div>
          <button className="primary-button" onClick={verifyNow} disabled={verifying}><Fingerprint size={17} />{verifying ? 'Verifying…' : 'Verify every block now'}</button>
        </section>
      )}

      <div className="tabs">
        {[['blocks', 'Blocks'], ['batches', 'Batch chains'], ['search', 'Search records'], ['contract', 'Smart contract'], ...(session.user?.role === 'KVIC_HEAD' ? [['system', 'Databases & backups']] : [])].map(([id, label]) => (
          <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === 'blocks' && <BlockList onOpen={setBlockHeight} head={info?.height} />}
      {tab === 'batches' && <BatchChains orgId={orgId} onClearOrg={() => setOrgId(null)} openCode={batchCode} onOpen={setBatchCode} />}
      {tab === 'search' && <SearchRecords onOpenBlock={setBlockHeight} />}
      {tab === 'contract' && <SmartContract canSeeQueue={['KVIC_HEAD', 'STATE_OFFICER'].includes(session.user?.role)} />}
      {tab === 'system' && <SystemHealth />}

      {blockHeight !== null && <BlockModal height={blockHeight} onClose={() => setBlockHeight(null)} />}
    </>
  )
}

// A link to the public block explorer (Polygonscan) when the chain has one, plain text otherwise.
const ExplorerLink = ({ base, kind, value, children }) => (base && value
  ? <a href={`${base}/${kind}/${value}`} target="_blank" rel="noopener noreferrer">{children}</a>
  : <>{children}</>)

const OUTBOX_LABELS = { SET_ROLE: 'Grant signing role', REGISTER_BATCH: 'Register batch (harvester signature)', CERTIFY_BATCH: 'Certify batch (officer signature)', REGISTER_JARS: 'Register jars (Merkle root)', LOOSE_SALE: 'Record loose sale', LOOSE_REVERSE: 'Reverse loose sale', ANCHOR: 'Anchor ledger head' }

// The Solidity contract that mirrors the ledger: who signed, which transaction, which block.
function SmartContract({ canSeeQueue }) {
  const status = useLive('/chain/status', { interval: 4000 })
  const queue = useLive('/chain/outbox?limit=40', { interval: 4000, enabled: canSeeQueue })
  const info = status.data
  const rows = queue.data || []

  if (!info) return <section className="panel"><Empty>{status.error || 'Loading…'}</Empty></section>
  if (!info.enabled) return <section className="panel"><Empty>The smart-contract link is switched off (CHAIN_ENABLED=false). The internal ledger keeps working.</Empty></section>

  return (
    <>
      <section className="panel">
        <div className="panel-header"><div><h2>HoneyChain smart contract</h2><p>A Solidity contract on an EVM chain. A batch is registered with the harvester's signature and certified with a second, certified officer's signature (EIP-712). Jars are proven with a Merkle root, and the head of the ledger above is anchored here.</p></div><em className={`status ${info.connected ? 'green' : 'red'}`}>{info.connected ? 'Connected' : 'Not reachable'}</em></div>
        <div className="kv-grid">
          <div><span>Contract address</span><strong className="mono"><ExplorerLink base={info.explorer} kind="address" value={info.contract}>{info.contract || '—'}</ExplorerLink></strong></div>
          <div><span>Chain ID · network</span><strong>{info.chainId ?? '—'} · <span className="mono">{info.rpcUrl}</span></strong></div>
          <div><span>Latest block</span><strong>{info.blockNumber ?? '—'}</strong></div>
          <div><span>Gas-paying relayer</span><strong className="mono">{info.relayer || '—'}</strong></div>
          <div><span>Ledger head anchored</span><strong>{info.onChainAnchor?.height ? `#${info.onChainAnchor.height} · ${shortHash(info.onChainAnchor.head, 14)}` : 'not yet'}</strong></div>
          <div><span>Transactions sent</span><strong>{num(info.outbox.CONFIRMED)} confirmed · {num(info.outbox.PENDING)} waiting · {num(info.outbox.FAILED)} failed</strong></div>
        </div>
        {info.error && <p className="note">{info.error}</p>}
      </section>

      {canSeeQueue && (
        <section className="panel">
          <div className="panel-header"><div><h2>Transactions sent to the contract</h2><p>Newest first. Each row is one signed transaction with its hash and block.</p></div></div>
          {rows.length === 0 ? <Empty>Nothing has been sent yet. Harvest a batch in the beekeeper app.</Empty> : (
            <div className="block-list">
              {rows.map((row) => (
                <div className="block-row" key={row.id}>
                  <div className="block-height">{row.block_number ? `#${row.block_number}` : '…'}</div>
                  <div><strong>{OUTBOX_LABELS[row.kind] || row.kind}</strong><span className="sub">{row.ref}</span></div>
                  <div><em className={`status ${row.status === 'CONFIRMED' ? 'green' : row.status === 'FAILED' ? 'red' : 'amber'}`}>{row.status}</em></div>
                  <div><span className="mono">{row.tx_hash ? <ExplorerLink base={info.explorer} kind="tx" value={row.tx_hash}>{shortHash(row.tx_hash, 14)}</ExplorerLink> : (row.last_error || 'waiting')}</span><span className="sub">{fmtDateTime(row.updated_at)}</span></div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  )
}

// Every database file, its health, and the backups (KVIC head only).
function SystemHealth() {
  const health = useLive('/admin/system/health', { interval: 8000 })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const data = health.data

  async function backup() {
    setBusy(true); setMessage('')
    try {
      const made = await api('/admin/system/backup', { method: 'POST' })
      setMessage(`Export ${made.name} saved (${made.files} tables, ${made.rows} rows).`)
      health.refresh()
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }

  if (!data) return <section className="panel"><Empty>{health.error || 'Loading…'}</Empty></section>

  return (
    <>
      <section className="panel">
        <div className="panel-header"><div><h2>Databases</h2><p>One shared set of tables for identity, approvals and the ledger, and one private schema for every company. Each is read and counted now, so a broken connection or a missing table shows here.</p></div></div>
        <div className="block-list">
          {data.databases.map((item) => (
            <div className="block-row" key={item.name}>
              <div className="block-height">DB</div>
              <div><strong>{item.name === 'common' ? 'Common (Honey Chain shared)' : `Company schema ${item.name}`}</strong><span className="sub">{num(item.tables)} tables · {num(item.rows)} rows</span></div>
              <div><em className={`status ${item.result === 'ok' ? 'green' : 'red'}`}>{item.result === 'ok' ? 'Intact' : item.result}</em></div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>Backups</h2><p>Portable exports (one file per table) with a SHA-256 for every file, kept in <span className="mono">{data.backups.folder}</span>. The hosted database keeps its own backups as well.</p></div><button className="primary-button" onClick={backup} disabled={busy}>{busy ? 'Saving…' : 'Export now'}</button></div>
        {message && <p className="note">{message}</p>}
        {data.backups.latest.length === 0 ? <Empty>No export yet. One is taken automatically each day.</Empty> : (
          <div className="block-list">
            {data.backups.latest.map((item) => (
              <div className="block-row" key={item.name}>
                <div className="block-height">{item.files}</div>
                <div><strong>{item.name}</strong><span className="sub">{fmtDateTime(item.createdAt)}</span></div>
                <div className="mono">ledger {item.ledgerHead ? `#${item.ledgerHead.height}` : 'empty'}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}

function BlockList({ onOpen, head }) {
  const [limit, setLimit] = useState(25)
  const list = useLive(`/admin/chain/blocks?limit=${limit}`, { interval: 5000 })

  const blocks = list.data || []
  const lowest = blocks.length ? blocks[blocks.length - 1].height : 0
  const loadingMore = list.loading && blocks.length > 0
  const loadOlder = () => setLimit((current) => current + 25)

  return (
    <section className="panel">
      <div className="panel-header"><div><h2>Blocks</h2><p>Newest first. Each block seals a batch of transactions and links to the block before it.</p></div></div>
      {blocks.length === 0 ? <Empty>No blocks yet.</Empty> : (
        <div className="block-list">
          {blocks.map((block) => (
            <div className="block-row" key={block.height} onClick={() => onOpen(block.height)}>
              <div className="block-height">#{block.height}</div>
              <div><strong>{block.height === 0 ? 'Genesis block' : `${block.tx_count} transaction${block.tx_count === 1 ? '' : 's'}`}</strong><span className="sub">{fmtDateTime(block.timestamp)} · {block.validator_id}</span></div>
              <div className="mono">{block.height === head ? 'head' : ''}</div>
              <div><span className="mono">{shortHash(block.block_hash, 14)}</span><span className="sub">prev {shortHash(block.prev_hash, 8)}</span></div>
              <ChevronRight size={16} className="row-arrow" />
            </div>
          ))}
        </div>
      )}
      {lowest > 0 && <div className="button-row"><button className="secondary-button" onClick={loadOlder} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load older blocks'}</button></div>}
    </section>
  )
}

function BlockModal({ height, onClose }) {
  const { data, error } = useLive(`/admin/chain/blocks/${height}`, { interval: 30000 })

  if (!data) return <Modal title={`Block #${height}`} onClose={onClose} wide><Empty>{error || 'Loading…'}</Empty></Modal>

  const { block, events } = data

  return (
    <Modal title={`Block #${block.height}`} eyebrow={`${fmtDateTime(block.timestamp)} · sealed by ${block.validator_id}`} onClose={onClose} wide>
      <div className="kv-grid">
        <div><span>Block hash</span><strong className="mono">{block.block_hash}</strong></div>
        <div><span>Previous block</span><strong className="mono">{block.prev_hash}</strong></div>
        <div><span>Merkle root</span><strong className="mono">{block.merkle_root}</strong></div>
        <div><span>Transactions</span><strong>{block.tx_count}{block.height > 0 ? ` (events #${block.first_event_id}–#${block.last_event_id})` : ''}</strong></div>
        <div><span>Validator signature</span><strong className="mono">{block.signature.slice(0, 44)}…</strong></div>
      </div>
      <h3 className="section-title">Transactions</h3>
      {events.length === 0 ? <p className="note">The genesis block carries no transactions.</p> : (
        <div className="tx-list">
          {events.map((event) => (
            <div className="tx-row" key={event.id}>
              <strong>#{event.id} · {event.event_type}</strong> <small>{event.entity_type} {event.entity_id} · {fmtDateTime(event.created_at)}</small>
              <div className="mono">hash {shortHash(event.current_hash, 16)}</div>
              <pre>{JSON.stringify(event.payload, null, 1)}</pre>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

function BatchChains({ orgId, onClearOrg, openCode, onOpen }) {
  const [query, setQuery] = useState('')
  const path = `/admin/batches?q=${encodeURIComponent(query)}${orgId ? `&orgId=${orgId}` : ''}`
  const list = useLive(path, { interval: 6000 })
  const rows = list.data || []

  return (
    <section className="panel">
      <div className="panel-header"><div><h2>Batch chains</h2><p>Open a batch to follow its harvest, lab verification and packaging on the chain.</p></div></div>
      <div className="toolbar" style={{ marginTop: 16 }}>
        <div className="searchbox"><Search size={17} /><input placeholder="Search batch code or organisation" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        {orgId && <button className="chip active" onClick={onClearOrg}>Filtered by organisation ✕</button>}
      </div>
      {rows.length === 0 ? <Empty>No batches found.</Empty> : (
        <div className="table-scroll">
          <table className="dtable">
            <thead><tr><th>Batch</th><th>Organisation</th><th>Honey</th><th className="num">Quantity</th><th>Harvested</th><th className="num">Bottles</th><th>Lab</th><th>Status</th><th /></tr></thead>
            <tbody>{rows.map((batch) => (
              <tr key={batch.code} className="clickable" onClick={() => onOpen(batch.code)}>
                <td><strong>{batch.code}</strong></td><td>{batch.orgName}</td><td>{batch.honeyType}</td><td className="num">{kg(batch.quantityKg)}</td>
                <td>{fmtDate(batch.harvestDate)}</td><td className="num">{batch.bottles}</td>
                <td>{batch.labStatus ? <StatusPill status={batch.labStatus} /> : <small>Not shared</small>}</td>
                <td><StatusPill status={batch.status} /></td><td><ChevronRight size={16} className="row-arrow" /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {openCode && <BatchModal code={openCode} onClose={() => onOpen(null)} />}
    </section>
  )
}

function BatchModal({ code, onClose }) {
  const { data, error } = useLive(`/admin/batches/${encodeURIComponent(code)}`, { interval: 6000 })
  const [block, setBlock] = useState(null)

  if (!data) return <Modal title={code} onClose={onClose} wide><Empty>{error || 'Loading…'}</Empty></Modal>

  const { batch, capacity, packBatches, events } = data

  return (
    <Modal title={batch.code} eyebrow={`${batch.orgName} · ${batch.orgCode}`} onClose={onClose} wide>
      <div className="kv-grid">
        <div><span>Honey</span><strong>{batch.honeyType} · {kg(batch.quantityKg)}</strong></div>
        <div><span>Harvested</span><strong>{fmtDate(batch.harvestDate)} · hive {batch.hiveCode}</strong></div>
        <div><span>Status</span><strong><StatusPill status={batch.status} /></strong></div>
        <div><span>Bottle capacity used</span><strong>{num(capacity.packedGrams)} g of {num(capacity.totalGrams)} g</strong></div>
        <div><span>Bottles reserved</span><strong>{capacity.packedBottles}</strong></div>
        <div><span>Honey left to pack</span><strong>{num(capacity.remainingGrams)} g</strong></div>
      </div>

      <h3 className="section-title">Chain of custody</h3>
      <div className="timeline">
        {events.map((event, index) => (
          <div className={`timeline-event ${index === events.length - 1 ? 'last' : ''}`} key={event.id}>
            <span className="timeline-icon"><Blocks size={16} /></span>
            <div>
              <strong>{event.event_type.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase())}</strong>
              <p>{event.entity_type} {event.entity_id}</p>
              <time>{fmtDateTime(event.created_at)} · <button className="link-btn" onClick={() => setBlock(event.block_height)}>block #{event.block_height}</button> · <span className="mono">{shortHash(event.current_hash, 12)}</span></time>
            </div>
          </div>
        ))}
      </div>

      {packBatches.length > 0 && <>
        <h3 className="section-title">Packaging batches</h3>
        <div className="table-scroll">
          <table className="dtable">
            <thead><tr><th>Pack batch</th><th>Product</th><th className="num">Jar</th><th className="num">QR codes</th><th>Created</th></tr></thead>
            <tbody>{packBatches.map((pb) => <tr key={pb.code}><td><strong>{pb.code}</strong></td><td>{pb.productName}</td><td className="num">{pb.jarSizeGrams} g</td><td className="num">{pb.packsCreated} / {pb.quantityToPack}</td><td>{fmtDateTime(pb.createdAt)}</td></tr>)}</tbody>
          </table>
        </div>
      </>}

      {block && <BlockModal height={block} onClose={() => setBlock(null)} />}
    </Modal>
  )
}

function SearchRecords({ onOpenBlock }) {
  const [entityType, setEntityType] = useState('BATCH')
  const [entityId, setEntityId] = useState('')
  const [results, setResults] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => { setResults(null) }, [entityType])

  async function search(event) {
    event.preventDefault()
    setError('')
    try {
      setResults(await api(`/admin/chain/events?entityType=${entityType}&entityId=${encodeURIComponent(entityId.trim())}`))
    } catch (searchError) { setError(searchError.message) }
  }

  return (
    <section className="panel">
      <div className="panel-header"><div><h2>Search records</h2><p>Find every transaction for a batch code, bottle ID, packaging batch or organisation code.</p></div></div>
      <form className="toolbar" style={{ marginTop: 16 }} onSubmit={search}>
        <label className="field" style={{ margin: 0 }}><select value={entityType} onChange={(event) => setEntityType(event.target.value)}>{ENTITY_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
        <div className="searchbox"><Search size={17} /><input placeholder="e.g. HC-2026-0009 or PB-2026-EF46381B-JAR-000001" value={entityId} onChange={(event) => setEntityId(event.target.value)} required /></div>
        <button className="primary-button compact-button">Search</button>
      </form>
      {error && <div className="form-error">{error}</div>}
      {results && (results.length === 0 ? <Empty>No transactions found for that ID.</Empty> : (
        <div className="table-scroll">
          <table className="dtable">
            <thead><tr><th>#</th><th>Event</th><th>Record</th><th>Time</th><th>Block</th><th>Hash</th></tr></thead>
            <tbody>{results.map((event) => (
              <tr key={event.id} className="clickable" onClick={() => onOpenBlock(event.block_height)}>
                <td>{event.id}</td><td><strong>{event.event_type}</strong></td><td>{event.entity_type} {event.entity_id}</td>
                <td>{fmtDateTime(event.created_at)}</td><td>#{event.block_height}</td><td className="mono">{shortHash(event.current_hash, 12)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ))}
    </section>
  )
}
