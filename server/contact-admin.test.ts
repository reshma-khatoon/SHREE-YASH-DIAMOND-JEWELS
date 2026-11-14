import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app'

const mocks = vi.hoisted(() => ({ from: vi.fn(), getUser: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { from: mocks.from, auth: { getUser: mocks.getUser } } }))

describe('contact inquiries in the admin panel', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.resetAllMocks()
  })

  it('lists a saved inquiry even when both notifications fail', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-id')
    vi.stubEnv('SMTP_HOST', 'smtp.example.test')
    vi.stubEnv('SMTP_USER', 'owner@example.test')
    vi.stubEnv('SMTP_PASS', 'test-password')
    vi.stubEnv('OWNER_EMAIL', 'owner@example.test')
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', 'test-token')
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '123456')
    vi.stubEnv('WHATSAPP_OWNER_NUMBER', '919876543210')
    vi.stubEnv('WHATSAPP_TEMPLATE_NAME', 'new_enquiry')
    vi.stubEnv('WHATSAPP_TEMPLATE_LANGUAGE', 'en')
    vi.stubEnv('WHATSAPP_API_VERSION', 'v99.0')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const records: Record<string, unknown>[] = []
    const order = vi.fn()
    order.mockReturnValue({ order, range: vi.fn().mockImplementation(async () => ({ data: records, error: null })) })
    mocks.from.mockImplementation((table: string) => {
      if (table === 'admins') return { select: vi.fn().mockResolvedValue({ data: [{ email: 'admin@example.test' }], error: null }) }
      if (table === 'inquiries') return {
        insert: vi.fn().mockImplementation(async (record: Record<string, unknown>) => {
          records.push({ id: 1, admin_status: 'new', ...record })
          return { error: null }
        }),
        select: vi.fn().mockReturnValue({ order }),
      }
      throw new Error('Unexpected table')
    })
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'admin-id', email: 'admin@example.test' } }, error: null })
    const nativeFetch = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => String(input).startsWith('https://graph.facebook.com/')
      ? Promise.resolve(new Response(JSON.stringify({ error: { code: 190 } }), { status: 401 }))
      : nativeFetch(input, init))

    const app = createApp(vi.fn().mockRejectedValue(new Error('SMTP unavailable')))
    const server = app.listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not start')
    const base = `http://127.0.0.1:${address.port}`
    try {
      const submission = await fetch(`${base}/api/contact`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Customer', phone: '+919876543210', email: 'customer@example.test', message: 'Please call.' }),
      })
      expect(submission.status).toBe(201)
      expect(await submission.json()).toMatchObject({ ok: true, notificationStatus: 'failed', whatsappNotificationStatus: 'failed' })
      const admin = await fetch(`${base}/api/admin/inquiries`, { headers: { Authorization: 'Bearer test-admin-token' } })
      expect(admin.status).toBe(200)
      expect(await admin.json()).toMatchObject({ records: [{
        name: 'Test Customer', phone: '+919876543210', email: 'customer@example.test', message: 'Please call.',
      }] })
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })
})
