import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAdminRouter } from './admin'

vi.mock('./supabase', () => ({ supabase: {} }))

function setup() {
  const deps = {
    signIn: vi.fn().mockResolvedValue({
      accessToken: 'header.payload.signature', refreshToken: 'refresh-token', userId: 'admin-id', email: 'admin@example.com',
    }),
    getUser: vi.fn().mockImplementation(async (token: string) => token === 'header.payload.signature'
      ? { userId: 'admin-id', email: 'admin@example.com' } : null),
    isAdminEmail: vi.fn().mockResolvedValue(true),
    signOut: vi.fn().mockResolvedValue(undefined),
    counts: vi.fn().mockResolvedValue({
      inquiries: { total: 0, new: 0 }, orders: { total: 0, new: 0 }, cartLeads: { total: 0, new: 0 },
    }),
    list: vi.fn().mockResolvedValue([{ id: 1, admin_status: 'new' }]),
    update: vi.fn().mockResolvedValue(true),
    remove: vi.fn().mockResolvedValue(true),
    followUps: vi.fn().mockResolvedValue([]),
    history: vi.fn().mockResolvedValue([]),
    communicate: vi.fn().mockResolvedValue(true),
    allowedUserIds: vi.fn().mockReturnValue(['admin-id']),
  }
  const app = express()
  app.use(express.json())
  app.use('/api/admin', createAdminRouter(deps))
  const server = app.listen(0, '127.0.0.1')
  return { deps, server }
}

async function withServer(run: (base: string, deps: ReturnType<typeof setup>['deps']) => Promise<void>) {
  const { deps, server } = setup()
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not start')
  try { await run(`http://127.0.0.1:${address.port}/api/admin`, deps) }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
}

async function login(base: string) {
  const response = await fetch(`${base}/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'password' }),
  })
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const data: { token: string; refreshToken: string } = await response.json()
  expect(data.refreshToken).toBe('refresh-token')
  return data.token
}

describe('admin authentication and APIs', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reports the local login failure stage without logging credentials', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      await withServer(async (base, deps) => {
        deps.signIn.mockResolvedValueOnce(null)
        const response = await fetch(`${base}/login`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'admin@example.com', password: 'secret-password' }),
        })
        expect(response.status).toBe(401)
        expect(log).toHaveBeenCalledWith('Development admin login:', 'credentials rejected')
        deps.allowedUserIds.mockReturnValueOnce(['admin-id']).mockReturnValueOnce(['other-id'])
        expect((await fetch(`${base}/login`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'admin@example.com', password: 'secret-password' }),
        })).status).toBe(403)
        expect(log).toHaveBeenCalledWith('Development admin login:', 'admin UID not allowed')
        deps.isAdminEmail.mockResolvedValueOnce(false)
        expect((await fetch(`${base}/login`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'admin@example.com', password: 'secret-password' }),
        })).status).toBe(403)
        expect(log).toHaveBeenCalledWith('Development admin login:', 'admin email not allowed')
        expect(JSON.stringify(log.mock.calls)).not.toContain('secret-password')
      })
    } finally { vi.unstubAllEnvs() }
  })

  it('protects and validates communication actions, history, and follow-up lists', async () => {
    await withServer(async (base, deps) => {
      for (const [path, method] of [['/follow-ups', 'GET'], ['/orders/1/history', 'GET'], ['/orders/1/communication', 'POST']]) {
        expect((await fetch(`${base}${path}`, { method })).status).toBe(401)
      }
      const headers = { Authorization: `Bearer ${await login(base)}`, 'Content-Type': 'application/json' }
      expect((await fetch(`${base}/follow-ups?offset=50`, { headers })).status).toBe(200)
      expect(deps.followUps).toHaveBeenCalledWith(50)
      expect((await fetch(`${base}/orders?contactStatus=follow-up`, { headers })).status).toBe(200)
      expect(deps.list).toHaveBeenLastCalledWith('orders', 0, 'follow-up')
      expect((await fetch(`${base}/orders?contactStatus=read`, { headers })).status).toBe(400)
      expect((await fetch(`${base}/orders/1/history`, { headers })).status).toBe(200)
      deps.history.mockResolvedValueOnce(null)
      expect((await fetch(`${base}/orders/999/history`, { headers })).status).toBe(404)
      for (const body of [
        { action: 'status', value: 'contacted' }, { action: 'schedule', value: '2026-12-01' },
        { action: 'note', value: 'Please call later' }, { action: 'complete' }, { action: 'call_opened' },
        { action: 'whatsapp_opened' }, { action: 'email_opened' },
        { action: 'outcome', method: 'email', value: 'Customer replied' },
      ]) {
        expect((await fetch(`${base}/orders/1/communication`, { method: 'POST', headers, body: JSON.stringify(body) })).status).toBe(200)
      }
      expect(deps.communicate).toHaveBeenLastCalledWith('orders', 1, 'admin-id', 'outcome', 'email:Customer replied')
      for (const body of [
        { action: 'status', value: 'replied' }, { action: 'schedule', value: '2026-02-30' },
        { action: 'note', value: '  ' }, { action: 'outcome', method: 'sms', value: 'Done' },
        { action: 'call_opened', value: 'tamper' },
      ]) {
        expect((await fetch(`${base}/orders/1/communication`, { method: 'POST', headers, body: JSON.stringify(body) })).status).toBe(400)
      }
      deps.communicate.mockResolvedValueOnce(false)
      expect((await fetch(`${base}/orders/999/communication`, { method: 'POST', headers, body: JSON.stringify({ action: 'complete' }) })).status).toBe(404)
      deps.isAdminEmail.mockResolvedValueOnce(false)
      expect((await fetch(`${base}/orders/1/history`, { headers })).status).toBe(401)
    })
  })

  it('only returns counts to authorized admins', async () => {
    await withServer(async (base, deps) => {
      expect((await fetch(`${base}/counts`)).status).toBe(401)
      expect((await fetch(`${base}/counts`, { headers: { Authorization: 'Bearer fake' } })).status).toBe(401)
      const headers = { Authorization: `Bearer ${await login(base)}` }
      deps.isAdminEmail.mockResolvedValueOnce(false)
      expect((await fetch(`${base}/counts`, { headers })).status).toBe(401)
      expect(deps.counts).not.toHaveBeenCalled()
      const response = await fetch(`${base}/counts`, { headers })
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.json()).toEqual({
        inquiries: { total: 0, new: 0 }, orders: { total: 0, new: 0 }, cartLeads: { total: 0, new: 0 },
      })
    })
  })

  it('authenticates, lists records, updates each allowed status, and logs out', async () => {
    await withServer(async (base, deps) => {
      const token = await login(base)
      expect(token).toBe('header.payload.signature')
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      expect((await fetch(`${base}/session`, { headers })).status).toBe(200)
      expect(deps.getUser).toHaveBeenCalledWith(token)
      expect(deps.isAdminEmail).toHaveBeenCalledWith('admin@example.com')
      for (const table of ['inquiries', 'orders', 'cart_leads']) {
        expect((await fetch(`${base}/${table}`, { headers })).status).toBe(200)
        for (const status of ['new', 'read', 'replied']) {
          expect((await fetch(`${base}/${table}/1/status`, {
            method: 'PATCH', headers, body: JSON.stringify({ status }),
          })).status).toBe(200)
          expect(deps.update).toHaveBeenLastCalledWith(table, 1, status)
        }
      }
      expect((await fetch(`${base}/logout`, { method: 'POST', headers })).status).toBe(200)
      expect(deps.signOut).toHaveBeenCalledWith(token)
    })
  })

  it('rejects missing and invalid credentials and unauthorized users', async () => {
    await withServer(async (base, deps) => {
      expect((await fetch(`${base}/orders`)).status).toBe(401)
      expect((await fetch(`${base}/session`)).status).toBe(401)
      expect((await fetch(`${base}/orders`, { headers: { Authorization: 'Bearer fake' } })).status).toBe(401)
      deps.signIn.mockResolvedValueOnce(null)
      expect((await fetch(`${base}/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@example.com', password: 'bad' }),
      })).status).toBe(401)
      deps.signIn.mockResolvedValueOnce({
        accessToken: 'other', refreshToken: 'other-refresh', userId: 'other-id', email: 'other@example.com',
      })
      const unauthorized = await fetch(`${base}/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'other@example.com', password: 'password' }),
      })
      expect(unauthorized.status).toBe(403)
      expect(await unauthorized.json()).not.toHaveProperty('refreshToken')
      expect(deps.signOut).toHaveBeenCalledWith('other')
      expect(deps.list).not.toHaveBeenCalled()
    })
  })

  it('rejects authenticated users absent from the admins table', async () => {
    await withServer(async (base, deps) => {
      deps.isAdminEmail.mockResolvedValueOnce(false)
      const response = await fetch(`${base}/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@example.com', password: 'password' }),
      })
      expect(response.status).toBe(403)
      expect(await response.json()).not.toHaveProperty('refreshToken')
      expect(deps.signOut).toHaveBeenCalledWith('header.payload.signature')
      expect(deps.list).not.toHaveBeenCalled()
    })
  })

  it('rechecks authorization on every request and rejects revoked sessions', async () => {
    await withServer(async (base, deps) => {
      const token = await login(base)
      deps.allowedUserIds.mockReturnValue([])
      expect((await fetch(`${base}/inquiries`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401)
      expect(deps.list).not.toHaveBeenCalled()
    })
  })

  it('rechecks the admins table on every request', async () => {
    await withServer(async (base, deps) => {
      const token = await login(base)
      deps.isAdminEmail.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
      const headers = { Authorization: `Bearer ${token}` }
      expect((await fetch(`${base}/session`, { headers })).status).toBe(200)
      expect((await fetch(`${base}/orders`, { headers })).status).toBe(401)
      expect(deps.list).not.toHaveBeenCalled()
    })
  })

  it('rechecks Supabase validation for each request', async () => {
    await withServer(async (base, deps) => {
      const token = await login(base)
      deps.getUser.mockResolvedValueOnce(null)
      const headers = { Authorization: `Bearer ${token}` }
      expect((await fetch(`${base}/cart_leads`, { headers })).status).toBe(401)
      expect((await fetch(`${base}/cart_leads`, { headers })).status).toBe(200)
      expect(deps.list).toHaveBeenCalledOnce()
    })
  })

  it('rejects expired sessions without reading data', async () => {
    await withServer(async (base, deps) => {
      deps.signIn.mockResolvedValueOnce({ accessToken: 'expired', refreshToken: 'refresh-token', userId: 'admin-id', email: 'admin@example.com' })
      const token = await login(base)
      expect((await fetch(`${base}/orders`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401)
      expect(deps.getUser).toHaveBeenCalledWith('expired')
      expect(deps.list).not.toHaveBeenCalled()
    })
  })

  it('accepts a valid Supabase token without a prior login on this router', async () => {
    await withServer(async (base, deps) => {
      const headers = { Authorization: 'Bearer header.payload.signature' }
      expect((await fetch(`${base}/session`, { headers })).status).toBe(200)
      expect(deps.getUser).toHaveBeenCalledWith('header.payload.signature')
      expect(deps.signIn).not.toHaveBeenCalled()
    })
  })

  it('fails closed without an admin allow-list', async () => {
    await withServer(async (base, deps) => {
      deps.allowedUserIds.mockReturnValue([])
      const response = await fetch(`${base}/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@example.com', password: 'password' }),
      })
      expect(response.status).toBe(503)
      expect(deps.signIn).not.toHaveBeenCalled()
    })
  })

  it('validates table, id, status and missing records', async () => {
    await withServer(async (base, deps) => {
      const token = await login(base)
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      for (const [path, body] of [
        ['/admins/1/status', { status: 'read' }],
        ['/orders/0/status', { status: 'read' }],
        ['/orders/1/status', { status: 'shipped' }],
        ['/orders/1/status', { status: 'read', customer: 'tamper' }],
      ] as const) {
        expect((await fetch(`${base}${path}`, { method: 'PATCH', headers, body: JSON.stringify(body) })).status).toBe(400)
      }
      expect(deps.update).not.toHaveBeenCalled()
      deps.update.mockResolvedValueOnce(false)
      expect((await fetch(`${base}/orders/123/status`, {
        method: 'PATCH', headers, body: JSON.stringify({ status: 'read' }),
      })).status).toBe(404)
    })
  })

  it('only lets authorized admins delete records from allowed tables', async () => {
    await withServer(async (base, deps) => {
      expect((await fetch(`${base}/orders/1`, { method: 'DELETE' })).status).toBe(401)
      expect((await fetch(`${base}/orders/1`, {
        method: 'DELETE', headers: { Authorization: 'Bearer fake' },
      })).status).toBe(401)
      const headers = { Authorization: `Bearer ${await login(base)}` }
      deps.allowedUserIds.mockReturnValueOnce([])
      expect((await fetch(`${base}/orders/1`, { method: 'DELETE', headers })).status).toBe(401)
      deps.isAdminEmail.mockResolvedValueOnce(false)
      expect((await fetch(`${base}/orders/1`, { method: 'DELETE', headers })).status).toBe(401)
      for (const path of ['/admins/1', '/orders/0', '/orders/not-a-number', '/orders/9007199254740992']) {
        expect((await fetch(`${base}${path}`, { method: 'DELETE', headers })).status).toBe(400)
      }
      expect(deps.remove).not.toHaveBeenCalled()
      for (const table of ['inquiries', 'orders', 'cart_leads']) {
        const response = await fetch(`${base}/${table}/1`, { method: 'DELETE', headers })
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
        expect(deps.remove).toHaveBeenLastCalledWith(table, 1)
      }
      deps.remove.mockResolvedValueOnce(false)
      const missing = await fetch(`${base}/orders/123`, { method: 'DELETE', headers })
      expect(missing.status).toBe(404)
      expect(await missing.json()).toEqual({ error: 'Record not found.' })
    })
  })
})
