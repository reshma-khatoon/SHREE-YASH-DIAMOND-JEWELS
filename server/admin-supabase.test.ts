import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAdminRouter } from './admin'

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { signInWithPassword: mocks.signIn } }),
}))
vi.mock('./supabase', () => ({
  supabase: {
    auth: { getUser: mocks.getUser, admin: { signOut: mocks.signOut } },
    from: mocks.from,
  },
}))

describe('admin Supabase integration', () => {
  afterEach(() => {
    vi.resetAllMocks()
    vi.unstubAllEnvs()
  })

  it('uses Supabase Auth and checks the configured UID and admins email on login and session requests', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://supabase.example.test')
    vi.stubEnv('SUPABASE_ANON_KEY', 'public-test-key')
    vi.stubEnv('ADMIN_USER_IDS', 'admin-id')
    mocks.signIn.mockResolvedValue({
      data: {
        user: { id: 'admin-id', email: 'Admin@example.test' },
        session: { access_token: 'supabase-token', refresh_token: 'supabase-refresh-token', expires_at: Math.floor(Date.now() / 1000) + 60 },
      },
      error: null,
    })
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'admin-id', email: 'Admin@example.test' } }, error: null })
    mocks.select.mockResolvedValue({ data: [{ email: 'admin@example.test' }], error: null })
    mocks.from.mockReturnValue({ select: mocks.select })
    const app = express()
    app.use(express.json())
    app.use('/api/admin', createAdminRouter())
    const server = app.listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not start')
    const base = `http://127.0.0.1:${address.port}/api/admin`
    try {
      const login = await fetch(`${base}/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'Admin@example.test', password: 'test-password' }),
      })
      expect(login.status).toBe(200)
      expect(mocks.signIn).toHaveBeenCalledWith({ email: 'Admin@example.test', password: 'test-password' })
      expect(mocks.from).toHaveBeenCalledWith('admins')
      expect(mocks.select).toHaveBeenCalledWith('email')
      const { token, refreshToken } = await login.json() as { token: string; refreshToken: string }
      expect(refreshToken).toBe('supabase-refresh-token')
      const headers = { Authorization: `Bearer ${token}` }
      expect((await fetch(`${base}/session`, { headers })).status).toBe(200)
      expect(mocks.getUser).toHaveBeenCalledWith('supabase-token')
      mocks.select.mockResolvedValueOnce({ data: [], error: null })
      expect((await fetch(`${base}/session`, { headers })).status).toBe(401)
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })

  it('deletes only the requested Supabase record and reports missing records', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-id')
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'admin-id', email: 'admin@example.test' } }, error: null })
    const selectDeleted = vi.fn().mockResolvedValueOnce({ data: [{ id: 42 }], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
    const eq = vi.fn().mockReturnValue({ select: selectDeleted })
    const deleteRows = vi.fn().mockReturnValue({ eq })
    mocks.from.mockImplementation((table: string) => table === 'admins'
      ? { select: vi.fn().mockResolvedValue({ data: [{ email: 'admin@example.test' }], error: null }) }
      : { delete: deleteRows })
    const app = express()
    app.use('/api/admin', createAdminRouter())
    const server = app.listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not start')
    const url = `http://127.0.0.1:${address.port}/api/admin/inquiries/42`
    try {
      const options = { method: 'DELETE', headers: { Authorization: 'Bearer supabase-token' } }
      expect((await fetch(url, options)).status).toBe(200)
      expect(mocks.from).toHaveBeenCalledWith('inquiries')
      expect(eq).toHaveBeenCalledWith('id', 42)
      expect(selectDeleted).toHaveBeenCalledWith('id')
      expect((await fetch(url, options)).status).toBe(404)
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })

  it('leaves other records and tables untouched when deleting a selected record', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-id')
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'admin-id', email: 'admin@example.test' } }, error: null })
    const records: Record<string, number[]> = { inquiries: [1, 2], orders: [1], cart_leads: [1] }
    mocks.from.mockImplementation((table: string) => {
      if (table === 'admins') return { select: vi.fn().mockResolvedValue({ data: [{ email: 'admin@example.test' }], error: null }) }
      return {
        delete: () => ({
          eq: (column: string, id: number) => ({
            select: async () => {
              if (column !== 'id') throw new Error('Unexpected filter')
              const found = records[table].includes(id)
              records[table] = records[table].filter((value) => value !== id)
              return { data: found ? [{ id }] : [], error: null }
            },
          }),
        }),
      }
    })
    const app = express()
    app.use('/api/admin', createAdminRouter())
    const server = app.listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not start')
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/admin/inquiries/1`, {
        method: 'DELETE', headers: { Authorization: 'Bearer supabase-token' },
      })
      expect(response.status).toBe(200)
      expect(records).toEqual({ inquiries: [2], orders: [1], cart_leads: [1] })
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })
})
