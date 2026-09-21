import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, CornerUpLeft, Landmark, Lock, MessageSquare, Send, ShieldAlert, Unlock, X } from 'lucide-react'

import { api, useLive } from '../api'
import { Empty, ErrorNote, fmtDateTime } from '../ui'

const LEVEL_CHIP = { REGIONAL: 'lvl-regional', STATE: 'lvl-state', CENTRAL: 'lvl-central' }
const FILTERS = [['ALL', 'All'], ['OPEN', 'Open'], ['ESCALATED', 'Escalated'], ['CLOSED', 'Closed']]

// Keeper tickets. The regional officer talks to the keeper and alone can close the ticket; they can
// hand it to the state office, or ask for the central office, which needs the state officer's approval.
export default function Tickets({ user, notify, refreshOverview, params }) {
  const [filter, setFilter] = useState('ALL')
  const [selected, setSelected] = useState(params?.ticketId || null)
  const list = useLive(`/admin/tickets?filter=${filter}`, { interval: 6000 })
  const rows = list.data || []

  useEffect(() => {
    if (!selected && rows[0]) setSelected(rows[0].id)
  }, [rows.length]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="ticket-layout">
      <aside className="ticket-list panel">
        <div className="chips" style={{ marginBottom: 12 }}>
          {FILTERS.map(([id, label]) => <button key={id} className={`chip ${filter === id ? 'active' : ''}`} onClick={() => setFilter(id)}>{label}</button>)}
        </div>
        {rows.length === 0 && <Empty>No tickets here. Keepers open them from Help &amp; Support in the keeper app.</Empty>}
        {rows.map((row) => (
          <button key={row.id} className={`ticket-item ${selected === row.id ? 'on' : ''}`} onClick={() => setSelected(row.id)}>
            <span className="ticket-top">
              <small>{row.code}</small>
              <span className={`lvl-chip ${LEVEL_CHIP[row.level]}`}>{row.pendingCentral ? 'Awaiting approval' : row.levelLabel}</span>
            </span>
            <b>{row.subject}</b>
            <small>{row.orgName} · {row.region}</small>
            {row.lastMessage && <em>{row.lastMessage.body}</em>}
            <span className="ticket-flags">
              {row.status === 'CLOSED' && <span className="flag closed">Closed</span>}
              {row.awaitingReply && <span className="flag reply">Needs your reply</span>}
              {row.awaitingApproval && <span className="flag approve">Needs your approval</span>}
            </span>
          </button>
        ))}
      </aside>

      <section className="ticket-thread panel">
        {selected
          ? <Thread key={selected} id={selected} user={user} notify={notify} onChanged={() => { list.refresh(); refreshOverview() }} />
          : <Empty>Choose a ticket to read the conversation.</Empty>}
      </section>
    </div>
  )
}

function Thread({ id, user, notify, onChanged }) {
  const thread = useLive(`/admin/tickets/${id}`, { interval: 5000 })
  const data = thread.data
  const [body, setBody] = useState('')
  const [internal, setInternal] = useState(false)
  const [action, setAction] = useState(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const bottom = useRef(null)

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }) }, [data?.messages.length])

  if (!data) return <Empty>{thread.error || 'Loading the conversation…'}</Empty>
  const p = data.permissions

  async function run(path, payload, message) {
    setError('')
    setBusy(true)
    try {
      await api(`/admin/tickets/${id}/${path}`, { method: 'POST', body: payload })
      notify(message)
      setAction(null)
      setNote('')
      setBody('')
      thread.refresh()
      onChanged()
    } catch (runError) { setError(runError.message) }
    setBusy(false)
  }

  const send = (event) => {
    event.preventDefault()
    if (body.trim()) run('messages', { body, internal: internal || !p.reply }, internal || !p.reply ? 'Internal note added' : 'Reply sent to the keeper')
  }

  const ACTIONS = {
    escalateState: { title: 'Ask the state officer to look at this', hint: 'The state office will see the whole conversation and can leave notes for you. The keeper keeps writing to you.', button: 'Send to the state office', path: 'escalate', payload: () => ({ target: 'STATE', reason: note }), done: 'Sent to the state office', label: 'Reason' },
    requestCentral: { title: 'Urgent: request the central office', hint: 'It reaches the central office only if the state officer approves your request.', button: 'Request approval', path: 'escalate', payload: () => ({ target: 'CENTRAL', reason: note }), done: 'Request sent to the state officer', label: 'Why is it urgent?' },
    approve: { title: 'Approve and send to the central office', hint: 'The central office will be able to read this ticket and leave notes.', button: 'Approve', path: 'central-decision', payload: () => ({ decision: 'APPROVED', note }), done: 'Ticket sent to the central office', label: 'Note (optional)' },
    decline: { title: 'Decline the request', hint: 'The ticket stays with the state office.', button: 'Decline', path: 'central-decision', payload: () => ({ decision: 'DECLINED', note }), done: 'Request declined', label: 'Why are you declining?' },
    handBack: { title: user.role === 'KVIC_HEAD' ? 'Hand back to the state office' : 'Hand back to the regional officer', hint: 'Add a note for the officer who receives it.', button: 'Hand back', path: 'return', payload: () => ({ note }), done: 'Ticket handed back', label: 'Note' },
    close: { title: 'Close this ticket', hint: 'The keeper is told it is closed and can no longer write here. You can reopen it later.', button: 'Close ticket', path: 'close', payload: () => ({ note }), done: 'Ticket closed', label: 'Closing note (optional)' },
  }
  const current = action && ACTIONS[action]

  return (
    <>
      <header className="thread-head">
        <div>
          <small>{data.code} · {data.orgName} · {data.region}, {data.state}</small>
          <h2>{data.subject}</h2>
          <p><span className={`lvl-chip ${LEVEL_CHIP[data.level]}`}>{data.pendingCentral ? 'Awaiting state approval for the central office' : `With the ${data.levelLabel.toLowerCase()}`}</span> {data.status === 'CLOSED' && <span className="flag closed">Closed</span>} · keeper {data.keeperName}</p>
        </div>
        <div className="thread-actions">
          {p.escalateState && <button className="small-button" onClick={() => setAction('escalateState')}><ArrowUpRight size={13} />To state officer</button>}
          {p.requestCentral && <button className="small-button danger" onClick={() => setAction('requestCentral')}><ShieldAlert size={13} />Urgent: central office</button>}
          {p.decide && <><button className="small-button approve" onClick={() => setAction('approve')}><Check size={13} />Approve for central</button><button className="small-button danger" onClick={() => setAction('decline')}><X size={13} />Decline</button></>}
          {p.handBack && <button className="small-button" onClick={() => setAction('handBack')}><CornerUpLeft size={13} />Hand back</button>}
          {p.close && <button className="small-button" onClick={() => setAction('close')}><Lock size={13} />Close</button>}
          {p.reopen && <button className="small-button approve" onClick={() => run('reopen', {}, 'Ticket reopened')}><Unlock size={13} />Reopen</button>}
        </div>
      </header>

      {!p.reply && data.status === 'OPEN' && <p className="note ticket-note"><Landmark size={14} /> You can read this ticket and leave internal notes. Only the keeper’s regional officer writes to the keeper and closes the ticket.</p>}

      <div className="thread-body">
        {data.messages.map((message) => {
          if (message.event) return <p key={message.id} className={`thread-event ${message.internal ? 'internal' : ''}`}>{message.internal ? 'Internal · ' : ''}{message.body}<small>{fmtDateTime(message.at)}</small></p>
          const mine = message.from === 'KEEPER'
          return (
            <div key={message.id} className={`bubble-row ${mine ? 'them' : 'us'}`}>
              <div className={`bubble ${message.internal ? 'internal' : mine ? 'keeper' : 'officer'}`}>
                <b>{mine ? `${data.keeperName || 'Keeper'} (keeper)` : message.name || message.from}{message.internal ? ' · internal note' : ''}</b>
                <p>{message.body}</p>
                <small>{fmtDateTime(message.at)}</small>
              </div>
            </div>
          )
        })}
        <div ref={bottom} />
      </div>

      {current ? (
        <form className="thread-compose" onSubmit={(event) => { event.preventDefault(); run(current.path, current.payload(), current.done) }}>
          <b>{current.title}</b>
          <small>{current.hint}</small>
          <label className="field">{current.label}<textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} required={!current.label.includes('optional')} maxLength={400} /></label>
          <ErrorNote>{error}</ErrorNote>
          <div className="button-row"><button className="primary-button" disabled={busy}>{current.button}</button><button type="button" className="secondary-button" onClick={() => { setAction(null); setError('') }}>Cancel</button></div>
        </form>
      ) : data.status === 'OPEN' ? (
        <form className="thread-compose" onSubmit={send}>
          {p.reply && <div className="compose-tabs"><button type="button" className={!internal ? 'on' : ''} onClick={() => setInternal(false)}><MessageSquare size={13} />Reply to keeper</button><button type="button" className={internal ? 'on' : ''} onClick={() => setInternal(true)}><Lock size={13} />Internal note</button></div>}
          <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={3} maxLength={1500} placeholder={p.reply && !internal ? 'Write to the keeper…' : 'Write a note for the other officers on this ticket. The keeper cannot see it.'} />
          <ErrorNote>{error}</ErrorNote>
          <div className="button-row"><button className="primary-button" disabled={busy || !body.trim()}><Send size={15} />{p.reply && !internal ? 'Send to keeper' : 'Add internal note'}</button></div>
        </form>
      ) : <p className="note ticket-note"><Lock size={14} /> This ticket is closed.</p>}
    </>
  )
}
