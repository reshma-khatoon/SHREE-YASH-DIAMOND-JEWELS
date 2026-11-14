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
        session: { access_token: 'supabase-token', expires_at: Math.floor(Date.now() / 1000) + 60 },
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
      const { token } = await login.json() as { token: string }
      const headers = { Authorization: `Bearer ${token}` }
      expect((await fetch(`${base}/session`, { headers })).status).toBe(200)
      expect(mocks.getUser).toHaveBeenCalledWith('supabase-token')
      mocks.select.mockResolvedValueOnce({ data: [], error: null })
      expect((await fetch(`${base}/session`, { headers })).status).toBe(401)
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })
})
