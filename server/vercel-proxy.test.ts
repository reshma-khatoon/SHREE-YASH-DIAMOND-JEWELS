import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import proxy from '../api/index'
import { createAdminRouter } from './admin'

vi.mock('./supabase', () => ({ supabase: {} }))

const backendOrigin = 'https://api.example.test'

function request(path: string, init?: RequestInit) {
  return new Request(`https://shop.example.test/api/index?${path}`, init)
}

describe('Vercel API proxy', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('forwards admin login and queries to the existing backend without altering JSON', async () => {
    vi.stubEnv('API_BACKEND_ORIGIN', backendOrigin)
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ token: 'test-token' }))
    vi.stubGlobal('fetch', fetchMock)
    const response = await proxy.fetch(request('__api_path=admin/login&offset=2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://shop.example.test' },
      body: JSON.stringify({ email: 'admin@example.test', password: 'test-password' }),
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ token: 'test-token' })
    const [url, options] = fetchMock.mock.calls[0]
    expect(url.toString()).toBe(`${backendOrigin}/api/admin/login?offset=2`)
    expect(options.method).toBe('POST')
    expect(options.headers.get('origin')).toBe('https://shop.example.test')
    expect(JSON.parse(new TextDecoder().decode(options.body))).toEqual({
      email: 'admin@example.test', password: 'test-password',
    })
    expect(options.redirect).toBe('manual')
  })

  it('preserves authenticated admin requests and JSON authorization failures', async () => {
    vi.stubEnv('API_BACKEND_ORIGIN', backendOrigin)
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: 'Please log in again.' }, { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    const response = await proxy.fetch(request('__api_path=admin/orders&offset=50', {
      headers: { Authorization: 'Bearer session-token' },
    }))
    expect(fetchMock.mock.calls[0][0].toString()).toBe(`${backendOrigin}/api/admin/orders?offset=50`)
    expect(fetchMock.mock.calls[0][1].headers.get('authorization')).toBe('Bearer session-token')
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Please log in again.' })
  })

  it('accepts the original URL when provided by the runtime', async () => {
    vi.stubEnv('API_BACKEND_ORIGIN', backendOrigin)
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const response = await proxy.fetch(new Request('https://shop.example.test/api/admin/session'))
    expect(response.status).toBe(200)
    expect(fetchMock.mock.calls[0][0].toString()).toBe(`${backendOrigin}/api/admin/session`)
  })

  it('forwards existing customer submission endpoints', async () => {
    vi.stubEnv('API_BACKEND_ORIGIN', backendOrigin)
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    for (const path of ['contact', 'cart-leads', 'orders']) {
      const response = await proxy.fetch(request(`__api_path=${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      }))
      expect(response.status).toBe(201)
      expect(fetchMock.mock.lastCall?.[0].toString()).toBe(`${backendOrigin}/api/${path}`)
    }
  })

  it('carries an admin session through login, verification and logout against Express', async () => {
    vi.stubEnv('API_BACKEND_ORIGIN', backendOrigin)
    const deps = {
      signIn: vi.fn().mockResolvedValue({
        accessToken: 'supabase-token', userId: 'admin-id', email: 'admin@example.test', expiresAt: Date.now() + 60000,
      }),
      getUser: vi.fn().mockResolvedValue({ userId: 'admin-id', email: 'admin@example.test' }),
      isAdminEmail: vi.fn().mockResolvedValue(true),
      signOut: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(true),
      allowedUserIds: () => ['admin-id'],
    }
    const app = express()
    app.use(express.json())
    app.use('/api/admin', createAdminRouter(deps))
    const server = app.listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not start')
    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', (url: URL, init: RequestInit) =>
      originalFetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init))
    try {
      const login = await proxy.fetch(request('__api_path=admin/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@example.test', password: 'test-password' }),
      }))
      expect(login.status).toBe(200)
      const { token } = await login.json() as { token: string }
      const headers = { Authorization: `Bearer ${token}` }
      expect((await proxy.fetch(request('__api_path=admin/session', { headers }))).status).toBe(200)
      expect((await proxy.fetch(request('__api_path=admin/logout', { method: 'POST', headers }))).status).toBe(200)
      expect(deps.isAdminEmail).toHaveBeenCalledWith('admin@example.test')
      expect(deps.signOut).toHaveBeenCalledWith('supabase-token')
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })

  it('fails with JSON when backend configuration or route is invalid', async () => {
    vi.stubEnv('API_BACKEND_ORIGIN', '')
    vi.stubEnv('VITE_API_BASE_URL', '')
    expect((await proxy.fetch(request('__api_path=admin/login'))).status).toBe(503)
    vi.stubEnv('API_BACKEND_ORIGIN', 'https://shop.example.test')
    expect((await proxy.fetch(request('__api_path=admin/login'))).status).toBe(503)
    vi.stubEnv('API_BACKEND_ORIGIN', backendOrigin)
    const response = await proxy.fetch(request('__api_path=../admin/login'))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid API path.' })
    expect((await proxy.fetch(request('__api_path=admin/login', {
      headers: { 'x-shree-yash-api-proxy': '1' },
    }))).status).toBe(503)
  })

  it('returns JSON for upstream HTML, redirects and network errors', async () => {
    vi.stubEnv('API_BACKEND_ORIGIN', backendOrigin)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('The page could not be found', { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'https://other.example.test' } }))
      .mockRejectedValueOnce(new Error('offline'))
    vi.stubGlobal('fetch', fetchMock)
    for (let i = 0; i < 3; i++) {
      const response = await proxy.fetch(request('__api_path=admin/login'))
      expect(response.status).toBe(502)
      expect((await response.json()).error).toBeTruthy()
    }
  })
})
