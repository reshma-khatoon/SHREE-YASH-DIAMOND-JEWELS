import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAdminRouter } from './admin'

vi.mock('./supabase', () => ({ supabase: {} }))

function setup() {
  const deps = {
    signIn: vi.fn().mockResolvedValue({
      accessToken: 'header.payload.signature', userId: 'admin-id', email: 'admin@example.com', expiresAt: Date.now() + 60000,
    }),
    getUser: vi.fn().mockImplementation(async (token: string) => token === 'header.payload.signature'
      ? { userId: 'admin-id', email: 'admin@example.com' } : null),
    isAdminEmail: vi.fn().mockResolvedValue(true),
    signOut: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([{ id: 1, admin_status: 'new' }]),
    update: vi.fn().mockResolvedValue(true),
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
  const data: { token: string } = await response.json()
  return data.token
}

describe('admin authentication and APIs', () => {
  afterEach(() => vi.restoreAllMocks())

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
        accessToken: 'other', userId: 'other-id', email: 'other@example.com', expiresAt: Date.now() + 60000,
      })
      expect((await fetch(`${base}/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'other@example.com', password: 'password' }),
      })).status).toBe(403)
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
      deps.signIn.mockResolvedValueOnce({ accessToken: 'expired', userId: 'admin-id', expiresAt: Date.now() - 1 })
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
})
