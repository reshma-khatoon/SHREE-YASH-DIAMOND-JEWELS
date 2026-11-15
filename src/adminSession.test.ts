import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class TestStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

function token(expiresAt: number) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: 'admin-id', exp: expiresAt })}.c2ln`
}

describe('persistent admin sessions', () => {
  const storage = new TestStorage()
  const user = { id: 'admin-id', email: 'admin@example.test', aud: 'authenticated', role: 'authenticated' }
  let accessToken: string
  let refreshedToken: string
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    storage.clear()
    accessToken = token(Math.floor(Date.now() / 1000) + 3600)
    refreshedToken = token(Math.floor(Date.now() / 1000) + 7200)
    vi.stubEnv('VITE_SUPABASE_URL', 'https://supabase.example.test')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-anon-key')
    vi.stubGlobal('window', { localStorage: storage, dispatchEvent: vi.fn() })
    fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/api/admin/login')) {
        return Response.json({ token: accessToken, refreshToken: 'refresh-1' })
      }
      if (url.endsWith('/auth/v1/user')) return Response.json(user)
      if (url.includes('/auth/v1/token?grant_type=refresh_token')) {
        return Response.json({
          access_token: refreshedToken, refresh_token: 'refresh-2',
          expires_in: 7200, token_type: 'bearer', user,
        })
      }
      if (url.includes('/auth/v1/logout') || url.endsWith('/api/admin/logout')) return Response.json({})
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('restores a saved session, refreshes an expired token, and clears it on logout', async () => {
    const first = await import('./adminSession')
    await first.signInAdmin('admin@example.test', 'test-password')
    const saved = storage.getItem('shreeYashAdminAuth')
    expect(saved).toBeTruthy()
    expect(saved).not.toContain('test-password')
    expect(saved).not.toContain('service_role')
    expect(JSON.parse(saved!).refresh_token).toBe('refresh-1')
    await first.adminClient().auth.stopAutoRefresh()

    vi.resetModules()
    const reopened = await import('./adminSession')
    const restored = await reopened.adminClient().auth.getSession()
    expect(restored.data.session?.access_token).toBe(accessToken)
    await reopened.adminClient().auth.stopAutoRefresh()

    const expired = JSON.parse(storage.getItem('shreeYashAdminAuth')!)
    expired.expires_at = Math.floor(Date.now() / 1000) - 1
    storage.setItem('shreeYashAdminAuth', JSON.stringify(expired))
    vi.resetModules()
    const afterExpiry = await import('./adminSession')
    const refreshed = await afterExpiry.adminClient().auth.getSession()
    expect(refreshed.data.session?.access_token).toBe(refreshedToken)
    expect(JSON.parse(storage.getItem('shreeYashAdminAuth')!).refresh_token).toBe('refresh-2')
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('grant_type=refresh_token'))).toBe(true)
    await afterExpiry.clearAdminSession()
    expect(storage.getItem('shreeYashAdminAuth')).toBeNull()
    await afterExpiry.adminClient().auth.stopAutoRefresh()
  })

  it('does not save a session when the admin API rejects login', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'Invalid credentials or unauthorized account.' }, { status: 403 }))
    const { signInAdmin, adminClient } = await import('./adminSession')
    await expect(signInAdmin('admin@example.test', 'test-password')).rejects.toThrow('Invalid credentials or unauthorized account.')
    expect(storage.getItem('shreeYashAdminAuth')).toBeNull()
    await adminClient().auth.stopAutoRefresh()
  })

  it('notifies listeners when an active session refreshes', async () => {
    const { signInAdmin, adminClient } = await import('./adminSession')
    await signInAdmin('admin@example.test', 'test-password')
    const auth = adminClient().auth
    const events: string[] = []
    const { data: { subscription } } = auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' && session?.access_token === refreshedToken) events.push(event)
    })
    const result = await auth.refreshSession()
    expect(result.data.session?.access_token).toBe(refreshedToken)
    expect(events).toContain('TOKEN_REFRESHED')
    subscription.unsubscribe()
    await auth.stopAutoRefresh()
  })

  it('revokes the server session when establishing the browser session fails', async () => {
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/api/admin/login')) return Response.json({ token: accessToken, refreshToken: 'refresh-1' })
      if (url.endsWith('/auth/v1/user')) return Response.json({ message: 'invalid token' }, { status: 401 })
      if (url.endsWith('/api/admin/logout')) return Response.json({ ok: true })
      throw new Error(`Unexpected request: ${url}`)
    })
    const { signInAdmin, adminClient } = await import('./adminSession')
    await expect(signInAdmin('admin@example.test', 'test-password')).rejects.toThrow('Could not save your admin session')
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/admin/logout'))).toBe(true)
    expect(storage.getItem('shreeYashAdminAuth')).toBeNull()
    await adminClient().auth.stopAutoRefresh()
  })

  it('clears local storage even when Supabase sign-out cannot reach the server', async () => {
    const { signInAdmin, adminClient, clearAdminSession, adminSessionClearedEvent } = await import('./adminSession')
    await signInAdmin('admin@example.test', 'test-password')
    vi.spyOn(adminClient().auth, 'signOut').mockRejectedValueOnce(new Error('offline'))
    await expect(clearAdminSession()).rejects.toThrow('local session was cleared')
    expect(storage.getItem('shreeYashAdminAuth')).toBeNull()
    expect(window.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: adminSessionClearedEvent }))
    await adminClient().auth.stopAutoRefresh()
  })
})
