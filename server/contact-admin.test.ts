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

  it('counts saved submissions across all pages and reflects status changes and deletion', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-id')
    vi.stubEnv('SMTP_HOST', '')
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', '')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    type Row = { id: number; admin_status: string }
    const rows: Record<string, Row[]> = { inquiries: [], orders: [], cart_leads: [] }
    let failCount = false
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'admin-id', email: 'admin@example.test' } }, error: null })
    mocks.from.mockImplementation((table: string) => {
      if (table === 'admins') return { select: vi.fn().mockResolvedValue({ data: [{ email: 'admin@example.test' }], error: null }) }
      if (!(table in rows)) throw new Error('Unexpected table')
      return {
        insert: async () => {
          rows[table].push({ id: rows[table].length + 1, admin_status: 'new' })
          return { error: null }
        },
        select: (column: string, options: { count: string; head: boolean }) => {
          expect(column).toBe('id')
          expect(options).toEqual({ count: 'exact', head: true })
          const result = (onlyNew: boolean) => failCount
            ? { count: null, error: { message: 'database unavailable' } }
            : { count: rows[table].filter((row) => !onlyNew || row.admin_status === 'new').length, error: null }
          return {
            then: (resolve: (value: ReturnType<typeof result>) => void) => Promise.resolve(result(false)).then(resolve),
            eq: (field: string, value: string) => {
              expect([field, value]).toEqual(['admin_status', 'new'])
              return Promise.resolve(result(true))
            },
          }
        },
        update: (data: { admin_status: string }) => ({
          eq: (_field: string, id: number) => ({
            select: async () => {
              const row = rows[table].find((item) => item.id === id)
              if (row) row.admin_status = data.admin_status
              return { data: row ? [{ id }] : [], error: null }
            },
          }),
        }),
        delete: () => ({
          eq: (_field: string, id: number) => ({
            select: async () => {
              const found = rows[table].some((item) => item.id === id)
              rows[table] = rows[table].filter((item) => item.id !== id)
              return { data: found ? [{ id }] : [], error: null }
            },
          }),
        }),
      }
    })
    const server = createApp().listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not start')
    const base = `http://127.0.0.1:${address.port}`
    const adminHeaders = { Authorization: 'Bearer test-admin-token', 'Content-Type': 'application/json' }
    const post = (path: string, body: unknown) => fetch(`${base}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const getCounts = async () => {
      const response = await fetch(`${base}/api/admin/counts`, { headers: adminHeaders })
      expect(response.status).toBe(200)
      return response.json()
    }
    try {
      expect(await getCounts()).toEqual({
        inquiries: { total: 0, new: 0 }, orders: { total: 0, new: 0 }, cartLeads: { total: 0, new: 0 },
      })
      const customer = { name: 'Test Customer', phone: '+919876543210', address: '10 Test Road', city: 'Delhi', state: 'Delhi', pincode: '110001' }
      const items = [{ productId: 'celeste-diamond-ring', goldPurity: '18K', quantity: 1 }]
      expect((await post('/api/contact', { name: customer.name, phone: customer.phone, message: 'Please call.' })).status).toBe(201)
      expect((await post('/api/orders', { customer, items })).status).toBe(201)
      expect((await post('/api/cart-leads', { customer, items })).status).toBe(201)
      rows.inquiries.push(...Array.from({ length: 51 }, (_, index) => ({ id: index + 2, admin_status: 'read' })))
      expect(await getCounts()).toEqual({
        inquiries: { total: 52, new: 1 }, orders: { total: 1, new: 1 }, cartLeads: { total: 1, new: 1 },
      })
      expect((await fetch(`${base}/api/admin/inquiries/1/status`, {
        method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ status: 'replied' }),
      })).status).toBe(200)
      expect((await fetch(`${base}/api/admin/orders/1`, { method: 'DELETE', headers: adminHeaders })).status).toBe(200)
      expect(await getCounts()).toEqual({
        inquiries: { total: 52, new: 0 }, orders: { total: 0, new: 0 }, cartLeads: { total: 1, new: 1 },
      })
      expect((await fetch(`${base}/api/admin/cart_leads/1/status`, {
        method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ status: 'read' }),
      })).status).toBe(200)
      expect((await getCounts()).cartLeads).toEqual({ total: 1, new: 0 })
      failCount = true
      const failed = await fetch(`${base}/api/admin/counts`, { headers: adminHeaders })
      expect(failed.status).toBe(500)
      expect(await failed.json()).toEqual({ error: 'Admin request failed. Please try again.' })
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })
})
