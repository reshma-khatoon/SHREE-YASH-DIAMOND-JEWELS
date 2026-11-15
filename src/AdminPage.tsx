import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { adminRequest, AdminRequestError, type AdminCounts } from './adminApi'
import { adminClient, adminSessionClearedEvent, adminSessionStorageKey, clearAdminSession, clearRejectedSession, signInAdmin } from './adminSession'

type TableName = 'inquiries' | 'orders' | 'cart_leads'
type AdminStatus = 'new' | 'read' | 'replied'
type RecordData = {
  id: number
  created_at: string
  admin_status: AdminStatus
  [key: string]: unknown
}

const sections: { value: TableName; label: string }[] = [
  { value: 'inquiries', label: 'Enquiries' },
  { value: 'orders', label: 'Orders' },
  { value: 'cart_leads', label: 'Cart requests' },
]

export function useAdminSession() {
  const [session, setSession] = useState({ token: '', loading: true, error: '' })
  useEffect(() => {
    let active = true
    let version = 0
    try {
      const auth = adminClient().auth
      const { data: { subscription } } = auth.onAuthStateChange((event, current) => {
        if (!active || event === 'INITIAL_SESSION') return
        version += 1
        setSession({ token: current?.access_token ?? '', loading: false, error: '' })
      })
      const onCleared = () => {
        version += 1
        setSession({ token: '', loading: false, error: '' })
      }
      const onStorage = (event: StorageEvent) => {
        if (event.key === adminSessionStorageKey && event.newValue === null) onCleared()
      }
      window.addEventListener(adminSessionClearedEvent, onCleared)
      window.addEventListener('storage', onStorage)
      const initialVersion = version
      void auth.getSession().then(({ data, error }) => {
        if (!active || version !== initialVersion) return
        setSession({
          token: data.session?.access_token ?? '',
          loading: false,
          error: error ? 'Could not restore the admin session. Check your connection and try again.' : '',
        })
      }).catch(() => {
        if (active && version === initialVersion) {
          setSession({ token: '', loading: false, error: 'Could not restore the admin session. Check your connection and try again.' })
        }
      })
      return () => {
        active = false
        subscription.unsubscribe()
        window.removeEventListener(adminSessionClearedEvent, onCleared)
        window.removeEventListener('storage', onStorage)
      }
    } catch (error) {
      setSession({ token: '', loading: false, error: error instanceof Error ? error.message : 'Could not initialize admin login.' })
      return () => { active = false }
    }
  }, [])
  return session
}

type AdminSession = ReturnType<typeof useAdminSession>

function details(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value, null, 2)
}

function RecordCard({ record, table, onStatus, onDelete }: {
  record: RecordData
  table: TableName
  onStatus: (id: number, status: AdminStatus) => Promise<void>
  onDelete: (id: number, title: string) => Promise<void>
}) {
  const excluded = new Set(['id', 'created_at', 'admin_status'])
  const title = table === 'orders' ? details(record.order_id) : table === 'cart_leads' ? details(record.lead_id) : `Enquiry #${record.id}`
  return (
    <article className="admin-record">
      <div className="admin-record-header">
        <div><h3>{title}</h3><span>{new Date(record.created_at).toLocaleString('en-IN')}</span></div>
        <div className="admin-record-actions">
          <label>Status
            <select value={record.admin_status} onChange={(event) => void onStatus(record.id, event.target.value as AdminStatus)}>
              <option value="new">New</option><option value="read">Read</option><option value="replied">Replied</option>
            </select>
          </label>
          <button type="button" className="admin-delete-button" onClick={() => void onDelete(record.id, title)}
            aria-label={`Delete ${title}`}>Delete</button>
        </div>
      </div>
      <dl className="admin-details">
        {Object.entries(record).filter(([key]) => !excluded.has(key)).map(([key, value]) => (
          <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd><pre>{details(value)}</pre></dd></div>
        ))}
      </dl>
    </article>
  )
}

export function AdminLoginPage({ session }: { session: AdminSession }) {
  const navigate = useNavigate()
  const location = useLocation()
  const routeError = (location.state as { error?: string } | null)?.error ?? ''
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(routeError)
  const [busy, setBusy] = useState(false)
  const [checkingSession, setCheckingSession] = useState(false)

  useEffect(() => {
    if (!session.token) {
      setCheckingSession(false)
      return
    }

    let active = true
    setCheckingSession(true)
    adminRequest('/session', session.token)
      .then(() => { if (active) navigate('/admin', { replace: true }) })
      .catch(async (err: Error) => {
        if (!active) return
        if (err instanceof AdminRequestError && err.status === 401) {
          try { await clearRejectedSession(session.token) }
          catch (clearError) { if (active) setError(clearError instanceof Error ? clearError.message : 'Could not clear the session.') }
        } else setError(err.message)
      })
      .finally(() => { if (active) setCheckingSession(false) })

    return () => { active = false }
  }, [navigate, session.token])

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await signInAdmin(email, password)
      setPassword('')
      navigate('/admin', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (session.loading || checkingSession) {
    return <section className="container section-block admin-page"><p role="status">Verifying admin session…</p></section>
  }

  return (
    <section className="container section-block admin-page admin-login-page">
      <div className="page-heading">
        <p className="eyebrow">Shree Yash Administration</p>
        <h1>Admin Login</h1>
        <p>Sign in with your authorized account to continue.</p>
      </div>
      {(error || session.error) && <p className="inquiry-error" role="alert">{error || session.error}</p>}
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

export default function AdminPage({ session, counts, countsError, refreshCounts }: {
  session: AdminSession
  counts: AdminCounts | null
  countsError: string
  refreshCounts: () => void
}) {
  const navigate = useNavigate()
  const token = session.token
  const [verifiedToken, setVerifiedToken] = useState('')
  const [checkingSession, setCheckingSession] = useState(false)
  const [sessionCheckVersion, setSessionCheckVersion] = useState(0)
  const [table, setTable] = useState<TableName>('inquiries')
  const [offset, setOffset] = useState(0)
  const [records, setRecords] = useState<RecordData[]>([])
  const [recordsVersion, setRecordsVersion] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    if (!token) return
    let active = true
    setCheckingSession(true)
    setVerifiedToken('')
    adminRequest('/session', token)
      .then(() => { if (active) { setVerifiedToken(token); setError('') } })
      .catch(async (err: Error) => {
        if (!active) return
        if (err instanceof AdminRequestError && err.status === 401) {
          try { await clearRejectedSession(token) }
          catch (clearError) { if (active) setError(clearError instanceof Error ? clearError.message : 'Could not clear the session.'); return }
        }
        setError(err.message)
      })
      .finally(() => { if (active) setCheckingSession(false) })
    return () => { active = false }
  }, [token, sessionCheckVersion])

  useEffect(() => {
    if (token && verifiedToken === token) refreshCounts()
  }, [token, verifiedToken, refreshCounts])

  useEffect(() => {
    if (!token || verifiedToken !== token) return
    let active = true
    setRecords([])
    setError('')
    setBusy(true)
    adminRequest<{ records: RecordData[] }>(`/${table}?offset=${offset}`, token)
      .then((data) => { if (active) setRecords(data.records) })
      .catch(async (err: Error) => {
        if (!active) return
        if (err instanceof AdminRequestError && err.status === 401) {
          try {
            if (await clearRejectedSession(token) && active) {
              setVerifiedToken('')
              setRecords([])
            }
          } catch (clearError) {
            if (active) {
              setVerifiedToken('')
              setRecords([])
              setError(clearError instanceof Error ? clearError.message : 'Could not clear the session.')
            }
            return
          }
        }
        if (active) setError(err.message)
      })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [token, verifiedToken, table, offset, recordsVersion])

  async function logout() {
    setLoggingOut(true)
    setBusy(true)
    setError('')
    let logoutError = ''
    try {
      await adminRequest('/logout', token, 'POST')
    } catch (err) {
      logoutError = err instanceof Error ? err.message : 'Logout failed.'
    } finally {
      try { await clearAdminSession() }
      catch (err) { logoutError = logoutError || (err instanceof Error ? err.message : 'Logout failed.') }
      setVerifiedToken('')
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
      refreshCounts()
    } catch (err) {
      if (err instanceof AdminRequestError && err.status === 401) {
        try {
          if (await clearRejectedSession(token)) {
            setVerifiedToken('')
            setRecords([])
          }
        }
        catch (clearError) { setError(clearError instanceof Error ? clearError.message : 'Could not clear the session.'); return }
      }
      setError(err instanceof Error ? err.message : 'Status update failed.')
    } finally {
      setBusy(false)
    }
  }

  async function deleteRecord(id: number, title: string) {
    if (!window.confirm(`Permanently delete ${title}? This cannot be undone.`)) return
    setError('')
    setBusy(true)
    try {
      await adminRequest(`/${table}/${id}`, token, 'DELETE')
      setRecords((current) => current.filter((record) => record.id !== id))
      refreshCounts()
      if (records.length === 1 && offset > 0) setOffset((value) => Math.max(0, value - 50))
      else setRecordsVersion((value) => value + 1)
    } catch (err) {
      if (err instanceof AdminRequestError && err.status === 401) {
        try {
          if (await clearRejectedSession(token)) {
            setVerifiedToken('')
            setRecords([])
          }
        }
        catch (clearError) { setError(clearError instanceof Error ? clearError.message : 'Could not clear the session.'); return }
      }
      setError(err instanceof Error ? err.message : 'Delete failed.')
    } finally {
      setBusy(false)
    }
  }

  if (session.loading || loggingOut) {
    return <section className="container section-block admin-page"><p role="status">Verifying admin session…</p></section>
  }
  if (!token) return <Navigate to="/admin/login" replace state={error || session.error ? { error: error || session.error } : undefined} />
  if (checkingSession || verifiedToken !== token) {
    return <section className="container section-block admin-page">
      {error && !checkingSession
        ? <><p className="inquiry-error" role="alert">{error}</p><button type="button" onClick={() => setSessionCheckVersion((value) => value + 1)}>Retry</button></>
        : <p role="status">Verifying admin session…</p>}
    </section>
  }

  return (
    <section className="container section-block admin-page">
      <div className="page-heading"><p className="eyebrow">Shree Yash</p><h1>Admin dashboard</h1></div>
      {error && <p className="inquiry-error" role="alert">{error}</p>}
      <section className="admin-summary" aria-label="Dashboard counts">
        {countsError && <p className="inquiry-error" role="alert">Could not refresh dashboard counts: {countsError}</p>}
        {!counts && !countsError && <p role="status">Loading dashboard counts…</p>}
        {counts && <dl className="admin-counts">
          <div><dt>Inquiries</dt><dd>{counts.inquiries.total}</dd></div>
          <div><dt>Orders</dt><dd>{counts.orders.total}</dd></div>
          <div><dt>Cart leads</dt><dd>{counts.cartLeads.total}</dd></div>
        </dl>}
        {countsError && <button type="button" onClick={refreshCounts}>Retry counts</button>}
      </section>
      <div className="admin-toolbar">
        <div className="admin-tabs">
          {sections.map((section) => <button key={section.value} type="button" disabled={busy} aria-pressed={section.value === table}
            onClick={() => { setTable(section.value); setOffset(0) }}>{section.label}</button>)}
        </div>
        <button type="button" onClick={() => void logout()} disabled={busy}>Log out</button>
      </div>
      {busy ? <p>Loading…</p> : records.length === 0 ? <p>No records on this page.</p> : (
        <div className="admin-records">{records.map((record) => <RecordCard key={record.id} record={record} table={table} onStatus={updateStatus} onDelete={deleteRecord} />)}</div>
      )}
      <div className="admin-pagination">
        <button type="button" disabled={busy || offset === 0} onClick={() => setOffset((value) => Math.max(0, value - 50))}>Previous</button>
        <span>Page {offset / 50 + 1}</span>
        <button type="button" disabled={busy || records.length < 50} onClick={() => setOffset((value) => value + 50)}>Next</button>
      </div>
    </section>
  )
}
