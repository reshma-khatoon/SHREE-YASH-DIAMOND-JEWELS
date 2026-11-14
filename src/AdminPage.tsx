import { useEffect, useState, type FormEvent } from 'react'

type TableName = 'inquiries' | 'orders' | 'cart_leads'
type AdminStatus = 'new' | 'read' | 'replied'
type RecordData = {
  id: number
  created_at: string
  admin_status: AdminStatus
  [key: string]: unknown
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? ''
const sections: { value: TableName; label: string }[] = [
  { value: 'inquiries', label: 'Enquiries' },
  { value: 'orders', label: 'Orders' },
  { value: 'cart_leads', label: 'Cart requests' },
]

class AdminRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

async function adminRequest<T>(path: string, token?: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${apiBaseUrl}/api/admin${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store',
  })
  const data: unknown = await response.json()
  if (!response.ok) {
    const message = typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
      ? data.error : `Request failed (${response.status}).`
    throw new AdminRequestError(message, response.status)
  }
  return data as T
}

function details(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value, null, 2)
}

function RecordCard({ record, table, onStatus }: {
  record: RecordData
  table: TableName
  onStatus: (id: number, status: AdminStatus) => Promise<void>
}) {
  const excluded = new Set(['id', 'created_at', 'admin_status'])
  const title = table === 'orders' ? details(record.order_id) : table === 'cart_leads' ? details(record.lead_id) : `Enquiry #${record.id}`
  return (
    <article className="admin-record">
      <div className="admin-record-header">
        <div><h3>{title}</h3><span>{new Date(record.created_at).toLocaleString('en-IN')}</span></div>
        <label>Status
          <select value={record.admin_status} onChange={(event) => void onStatus(record.id, event.target.value as AdminStatus)}>
            <option value="new">New</option><option value="read">Read</option><option value="replied">Replied</option>
          </select>
        </label>
      </div>
      <dl className="admin-details">
        {Object.entries(record).filter(([key]) => !excluded.has(key)).map(([key, value]) => (
          <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd><pre>{details(value)}</pre></dd></div>
        ))}
      </dl>
    </article>
  )
}

export default function AdminPage() {
  const [token, setToken] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [table, setTable] = useState<TableName>('inquiries')
  const [offset, setOffset] = useState(0)
  const [records, setRecords] = useState<RecordData[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) return
    let active = true
    setRecords([])
    setError('')
    setBusy(true)
    adminRequest<{ records: RecordData[] }>(`/${table}?offset=${offset}`, token)
      .then((data) => { if (active) setRecords(data.records) })
      .catch((err: Error) => {
        if (active) {
          if (err instanceof AdminRequestError && err.status === 401) setToken('')
          setError(err.message)
        }
      })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [token, table, offset])

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await adminRequest<{ token: string }>('/login', undefined, 'POST', { email, password })
      setPassword('')
      setToken(result.token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.')
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    setBusy(true)
    setError('')
    try {
      await adminRequest('/logout', token, 'POST')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Logout failed.')
    } finally {
      setToken('')
      setRecords([])
      setBusy(false)
    }
  }

  async function updateStatus(id: number, status: AdminStatus) {
    setError('')
    setBusy(true)
    try {
      await adminRequest(`/${table}/${id}/status`, token, 'PATCH', { status })
      setRecords((current) => current.map((record) => record.id === id ? { ...record, admin_status: status } : record))
    } catch (err) {
      if (err instanceof AdminRequestError && err.status === 401) {
        setToken('')
        setRecords([])
      }
      setError(err instanceof Error ? err.message : 'Status update failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="container section-block admin-page">
      <div className="page-heading"><p className="eyebrow">Shree Yash</p><h1>Admin dashboard</h1></div>
      {error && <p className="inquiry-error" role="alert">{error}</p>}
      {!token ? (
        <form className="contact-form admin-login" onSubmit={(event) => void login(event)}>
          <label>Email<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button className="primary-button" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
      ) : (
        <>
          <div className="admin-toolbar">
            <div className="admin-tabs">
              {sections.map((section) => <button key={section.value} type="button" disabled={busy} aria-pressed={section.value === table}
                onClick={() => { setTable(section.value); setOffset(0) }}>{section.label}</button>)}
            </div>
            <button type="button" onClick={() => void logout()} disabled={busy}>Log out</button>
          </div>
          {busy ? <p>Loading…</p> : records.length === 0 ? <p>No records on this page.</p> : (
            <div className="admin-records">{records.map((record) => <RecordCard key={record.id} record={record} table={table} onStatus={updateStatus} />)}</div>
          )}
          <div className="admin-pagination">
            <button type="button" disabled={busy || offset === 0} onClick={() => setOffset((value) => Math.max(0, value - 50))}>Previous</button>
            <span>Page {offset / 50 + 1}</span>
            <button type="button" disabled={busy || records.length < 50} onClick={() => setOffset((value) => value + 50)}>Next</button>
          </div>
        </>
      )}
    </section>
  )
}
