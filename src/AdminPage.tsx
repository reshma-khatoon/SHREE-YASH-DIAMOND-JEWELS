import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'

type TableName = 'inquiries' | 'orders' | 'cart_leads'
type AdminStatus = 'new' | 'read' | 'replied'
type RecordData = {
  id: number
  created_at: string
  admin_status: AdminStatus
  [key: string]: unknown
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? ''
const sessionStorageKey = 'shreeYashAdminSession'
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

function storedAdminToken(): string {
  try {
    return window.sessionStorage.getItem(sessionStorageKey) ?? ''
  } catch {
    return ''
  }
}

function clearStoredAdminToken() {
  try {
    window.sessionStorage.removeItem(sessionStorageKey)
  } catch {
    // The in-memory token is still cleared; it cannot authorize another request without server validation.
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

export function AdminLoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const routeError = (location.state as { error?: string } | null)?.error ?? ''
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(routeError)
  const [busy, setBusy] = useState(false)
  const [checkingSession, setCheckingSession] = useState(Boolean(storedAdminToken()))

  useEffect(() => {
    const token = storedAdminToken()
    if (!token) {
      setCheckingSession(false)
      return
    }

    let active = true
    adminRequest('/session', token)
      .then(() => { if (active) navigate('/admin', { replace: true }) })
      .catch((err: Error) => {
        if (!active) return
        if (err instanceof AdminRequestError && err.status === 401) clearStoredAdminToken()
        else setError(err.message)
      })
      .finally(() => { if (active) setCheckingSession(false) })

    return () => { active = false }
  }, [navigate])

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await adminRequest<{ token: string }>('/login', undefined, 'POST', { email, password })
      try {
        window.sessionStorage.setItem(sessionStorageKey, result.token)
      } catch {
        throw new Error('This browser could not save your admin session. Enable session storage and try again.')
      }
      setPassword('')
      navigate('/admin', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (checkingSession) {
    return <section className="container section-block admin-page"><p role="status">Verifying admin session…</p></section>
  }

  return (
    <section className="container section-block admin-page admin-login-page">
      <div className="page-heading">
        <p className="eyebrow">Shree Yash Administration</p>
        <h1>Admin Login</h1>
        <p>Sign in with your authorized account to continue.</p>
      </div>
      {error && <p className="inquiry-error" role="alert">{error}</p>}
      <form className="contact-form admin-login" onSubmit={(event) => void login(event)}>
        <label>Email
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
          />
        </label>
        <label>Password
          <span className="admin-password-field">
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
            />
            <button
              className="admin-password-toggle"
              type="button"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((visible) => !visible)}
              disabled={busy}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </span>
        </label>
        <button className="primary-button" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </section>
  )
}

export default function AdminPage() {
  const navigate = useNavigate()
  const [token, setToken] = useState(storedAdminToken)
  const [authorized, setAuthorized] = useState(false)
  const [checkingSession, setCheckingSession] = useState(Boolean(storedAdminToken()))
  const [table, setTable] = useState<TableName>('inquiries')
  const [offset, setOffset] = useState(0)
  const [records, setRecords] = useState<RecordData[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) return
    let active = true
    setCheckingSession(true)
    adminRequest('/session', token)
      .then(() => { if (active) setAuthorized(true) })
      .catch((err: Error) => {
        if (!active) return
        clearStoredAdminToken()
        setToken('')
        setAuthorized(false)
        setError(err.message)
      })
      .finally(() => { if (active) setCheckingSession(false) })
    return () => { active = false }
  }, [token])

  useEffect(() => {
    if (!token || !authorized) return
    let active = true
    setRecords([])
    setError('')
    setBusy(true)
    adminRequest<{ records: RecordData[] }>(`/${table}?offset=${offset}`, token)
      .then((data) => { if (active) setRecords(data.records) })
      .catch((err: Error) => {
        if (active) {
          if (err instanceof AdminRequestError && err.status === 401) {
            clearStoredAdminToken()
            setToken('')
            setAuthorized(false)
          }
          setError(err.message)
        }
      })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [token, authorized, table, offset])

  async function logout() {
    setBusy(true)
    setError('')
    let logoutError = ''
    try {
      await adminRequest('/logout', token, 'POST')
    } catch (err) {
      logoutError = err instanceof Error ? err.message : 'Logout failed.'
    } finally {
      clearStoredAdminToken()
      setToken('')
      setAuthorized(false)
      setRecords([])
      setBusy(false)
      navigate('/admin/login', { replace: true, state: logoutError ? { error: logoutError } : undefined })
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
        clearStoredAdminToken()
        setToken('')
        setAuthorized(false)
        setRecords([])
      }
      setError(err instanceof Error ? err.message : 'Status update failed.')
    } finally {
      setBusy(false)
    }
  }

  if (!token) return <Navigate to="/admin/login" replace state={error ? { error } : undefined} />
  if (checkingSession || !authorized) {
    return <section className="container section-block admin-page"><p role="status">Verifying admin session…</p></section>
  }

  return (
    <section className="container section-block admin-page">
      <div className="page-heading"><p className="eyebrow">Shree Yash</p><h1>Admin dashboard</h1></div>
      {error && <p className="inquiry-error" role="alert">{error}</p>}
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
    </section>
  )
}
