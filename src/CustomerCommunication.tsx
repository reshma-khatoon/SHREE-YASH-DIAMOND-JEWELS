import { useEffect, useState, type FormEvent } from 'react'
import { adminRequest } from './adminApi'
import { customerLinks, type CustomerRecord, type CustomerTable } from './customerContact'

type History = { id: number; event_type: string; detail: string | null; created_at: string }
type Action = { action: 'status' | 'schedule' | 'note'; value: string }
  | { action: 'outcome'; method: string; value: string }
  | { action: 'complete' | 'call_opened' | 'whatsapp_opened' | 'email_opened' }

const labels: Record<string, string> = {
  call_opened: 'Call initiated', whatsapp_opened: 'WhatsApp chat opened', email_opened: 'Email compose opened',
  note_added: 'Note added', status_changed: 'Status changed', follow_up_scheduled: 'Follow-up scheduled',
  follow_up_completed: 'Follow-up completed', outcome_recorded: 'Outcome recorded',
}

function Icon({ kind }: { kind: 'call' | 'whatsapp' | 'email' }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {kind === 'call' ? <path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3l1.5 4.5-2 2a16 16 0 0 0 8.9 8.9l2-2z" />
      : kind === 'email' ? <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m3 6 9 7 9-7" /></>
        : <><path d="M20.5 11.6a8.6 8.6 0 0 1-12.7 7.6L3 20.5l1.3-4.6a8.6 8.6 0 1 1 16.2-4.3Z" /><path d="M8.5 7.5c.3 3.8 3.7 7.1 7.5 7.5l1-1.6-2.4-1.1-.9.9a7 7 0 0 1-3.1-3.1l.9-.9-1.1-2.4z" /></>}
  </svg>
}

export function CustomerCommunication({ record, table, token, onChange }: {
  record: CustomerRecord; table: CustomerTable; token: string; onChange: () => void
}) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<History[]>([])
  const [historyOffset, setHistoryOffset] = useState(0)
  const [historyVersion, setHistoryVersion] = useState(0)
  const [note, setNote] = useState('')
  const [outcome, setOutcome] = useState('')
  const [method, setMethod] = useState('call')
  const [date, setDate] = useState(record.follow_up_date || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const links = customerLinks(table, record)
  const base = `/${table}/${record.id}`

  useEffect(() => {
    if (!historyOpen) return
    let active = true
    adminRequest<{ history: History[] }>(`${base}/history?offset=${historyOffset}`, token)
      .then((result) => { if (active) setHistory(result.history) })
      .catch((err: Error) => { if (active) setError(err.message) })
    return () => { active = false }
  }, [base, token, historyOpen, historyOffset, historyVersion])

  async function save(action: Action, refresh = true) {
    setError('')
    setBusy(true)
    try {
      const linkOpened = action.action === 'call_opened' || action.action === 'whatsapp_opened' || action.action === 'email_opened'
      await adminRequest(`${base}/communication`, token, 'POST', action, linkOpened)
      setHistoryOffset(0)
      setHistoryVersion((value) => value + 1)
      if (refresh) onChange()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save communication.')
      return false
    } finally { setBusy(false) }
  }

  async function submitNote(event: FormEvent) {
    event.preventDefault()
    if (await save({ action: 'note', value: note }, false)) setNote('')
  }
  async function submitOutcome(event: FormEvent) {
    event.preventDefault()
    if (await save({ action: 'outcome', method, value: outcome })) setOutcome('')
  }
  const today = new Date()
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  return <section className="customer-communication" aria-label="Customer communication">
    <div className="contact-buttons">
      {(['call', 'whatsapp', 'email'] as const).map((kind) => links[kind]
        ? <a key={kind} href={links[kind]} target={kind === 'whatsapp' ? '_blank' : undefined} rel={kind === 'whatsapp' ? 'noopener noreferrer' : undefined}
          onClick={() => void save({ action: kind === 'call' ? 'call_opened' : kind === 'whatsapp' ? 'whatsapp_opened' : 'email_opened' }, false)}>
          <Icon kind={kind} />{kind === 'call' ? 'Call' : kind === 'whatsapp' ? 'WhatsApp' : 'Email'}
        </a>
        : <span key={kind} className="contact-unavailable"><Icon kind={kind} />{kind === 'call' ? 'Call' : kind === 'whatsapp' ? 'WhatsApp' : 'Email'} unavailable</span>)}
    </div>
    <p className="contact-hint">Opening a link does not confirm contact or send a message. Record the outcome below.</p>
    {error && <p className="inquiry-error" role="alert">{error}</p>}
    <div className="communication-fields">
      <label>Contact status
        <select disabled={busy} value={record.contact_status} onChange={(event) => void save({ action: 'status', value: event.target.value })}>
          <option value="new">New</option><option value="contacted">Contacted</option><option value="follow-up">Follow-up</option><option value="closed">Closed</option>
        </select>
      </label>
      <form onSubmit={(event) => { event.preventDefault(); void save({ action: 'schedule', value: date }) }}>
        <label>Follow-up date<input type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <button disabled={busy}>Schedule</button>
        {record.follow_up_date && <button type="button" disabled={busy} onClick={() => void save({ action: 'complete' })}>Mark completed</button>}
      </form>
    </div>
    {record.follow_up_date && <p><strong>{record.follow_up_date < localToday ? 'Overdue' : 'Pending'} follow-up:</strong> {record.follow_up_date}</p>}
    <p><strong>Last recorded contact:</strong> {record.last_contact_at ? `${new Date(record.last_contact_at).toLocaleString('en-IN')} (${record.last_contact_method})` : 'None'}</p>
    <details>
      <summary>Private notes and contact outcome</summary>
      <form className="communication-form" onSubmit={(event) => void submitNote(event)}>
        <label>Private note<textarea required maxLength={5000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <button disabled={busy}>Add note</button>
      </form>
      <form className="communication-form" onSubmit={(event) => void submitOutcome(event)}>
        <label>Contact method<select value={method} onChange={(event) => setMethod(event.target.value)}><option value="call">Call</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option></select></label>
        <label>Actual outcome<textarea required maxLength={5000} value={outcome} onChange={(event) => setOutcome(event.target.value)} /></label>
        <button disabled={busy}>Record outcome</button>
      </form>
    </details>
    <details onToggle={(event) => { setHistoryOpen(event.currentTarget.open); setHistoryOffset(0) }}>
      <summary>Contact history</summary>
      {history.length === 0 ? <p>No history on this page.</p> : <ul className="contact-history">{history.map((item) =>
        <li key={item.id}><strong>{labels[item.event_type] || item.event_type}</strong> · {new Date(item.created_at).toLocaleString('en-IN')}{item.detail && <div>{item.detail}</div>}</li>)}</ul>}
      <div className="admin-pagination"><button type="button" disabled={historyOffset === 0} onClick={() => setHistoryOffset((value) => Math.max(0, value - 50))}>Previous</button>
        <span>Page {historyOffset / 50 + 1}</span><button type="button" disabled={history.length < 50} onClick={() => setHistoryOffset((value) => value + 50)}>Next</button></div>
    </details>
  </section>
}
