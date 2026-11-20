import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app'
import type { SubmissionRecord } from './submissions'

vi.mock('./supabase', () => ({ supabase: { from: vi.fn() } }))
const mailMocks = vi.hoisted(() => ({ sendMail: vi.fn(), createTransport: vi.fn() }))
vi.mock('nodemailer', () => ({
  default: { createTransport: mailMocks.createTransport },
}))

const orderBody = {
  customer: {
    name: 'Test Customer',
    phone: '+919876543210',
    email: 'customer@example.com',
    address: '10 Test Road',
    city: 'Delhi',
    state: 'Delhi',
    pincode: '110001',
  },
  items: [{ productId: 'celeste-diamond-ring', goldPurity: '18K', quantity: 2 }],
}

async function withServer(
  sendEmail: ((message: { subject: string; text: string }) => Promise<void>) | undefined,
  run: (baseUrl: string) => Promise<void>,
  save: (record: SubmissionRecord) => Promise<void> = vi.fn<(record: SubmissionRecord) => Promise<void>>().mockResolvedValue(undefined),
) {
  const server = createApp(sendEmail, save).listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not start.')
  try {
    await run(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

describe('simple email API', () => {
  beforeEach(() => {
    vi.stubEnv('OWNER_EMAIL', 'owner@example.com')
    vi.stubEnv('SMTP_HOST', 'smtp.example.com')
    vi.stubEnv('SMTP_USER', 'owner@example.com')
    vi.stubEnv('SMTP_PASS', 'test-app-password')
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', '')
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '')
    vi.stubEnv('WHATSAPP_OWNER_NUMBER', '')
    vi.stubEnv('WHATSAPP_TEMPLATE_NAME', '')
    vi.stubEnv('WHATSAPP_TEMPLATE_LANGUAGE', '')
    vi.stubEnv('WHATSAPP_API_VERSION', '')
    mailMocks.sendMail.mockReset().mockResolvedValue({ accepted: ['owner@example.com'], rejected: [] })
    mailMocks.createTransport.mockReset().mockReturnValue({ sendMail: mailMocks.sendMail })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('returns JSON for missing API routes and oversized JSON requests', async () => {
    await withServer(vi.fn(), async (baseUrl) => {
      const missing = await fetch(`${baseUrl}/api/unknown`)
      expect(missing.status).toBe(404)
      expect(await missing.json()).toEqual({ error: 'API route not found.' })

      const oversized = await fetch(`${baseUrl}/api/contact`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'x'.repeat(21 * 1024) }),
      })
      expect(oversized.status).toBe(413)
      expect(await oversized.json()).toEqual({ error: 'Request body is too large.' })
    })
  })

  it('saves and emails contact form details and date/time', async () => {
    const sendEmail = vi.fn().mockResolvedValue(undefined)
    const save = vi.fn<(record: SubmissionRecord) => Promise<void>>().mockResolvedValue(undefined)
    await withServer(sendEmail, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Customer',
          phone: '+919876543210',
          email: 'customer@example.com',
          message: 'Please call me.',
        }),
      })
      expect(response.status).toBe(201)
      expect(await response.json()).toMatchObject({
        ok: true, notificationStatus: 'sent', whatsappNotificationStatus: 'not_configured',
      })
      expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
        subject: expect.stringContaining('contact'),
        text: expect.stringContaining('Please call me.'),
      }))
      expect(sendEmail.mock.calls[0][0].text).toContain('Date/time:')
      expect(sendEmail.mock.calls[0][0].text).toContain('Name: Test Customer')
      expect(sendEmail.mock.calls[0][0].text).toContain('Phone: +919876543210')
      expect(sendEmail.mock.calls[0][0].text).toContain('Email: customer@example.com')
      expect(save).toHaveBeenCalledWith(expect.objectContaining({
        type: 'contact',
        name: 'Test Customer',
        phone: '+919876543210',
        email: 'customer@example.com',
        message: 'Please call me.',
        receivedAt: expect.any(String),
      }))
    }, save)
  })

  it.each([
    ['failed', 'sent'],
    ['sent', 'failed'],
  ] as const)('saves contact and reports email %s and WhatsApp %s independently', async (emailStatus, whatsappStatus) => {
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', 'test-token')
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '123456')
    vi.stubEnv('WHATSAPP_OWNER_NUMBER', '919876543210')
    vi.stubEnv('WHATSAPP_TEMPLATE_NAME', 'new_enquiry')
    vi.stubEnv('WHATSAPP_TEMPLATE_LANGUAGE', 'en')
    vi.stubEnv('WHATSAPP_API_VERSION', 'v99.0')
    const nativeFetch = globalThis.fetch
    const providerFetch = vi.fn().mockResolvedValue(whatsappStatus === 'sent'
      ? new Response(JSON.stringify({ messages: [{ id: 'wamid.test' }] }), { status: 200 })
      : new Response(JSON.stringify({ error: { code: 190 } }), { status: 401 }))
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => String(input).startsWith('https://graph.facebook.com/')
      ? providerFetch(input, init) : nativeFetch(input, init))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const sendEmail = emailStatus === 'sent' ? vi.fn().mockResolvedValue(undefined) : vi.fn().mockRejectedValue(new Error('SMTP failed'))
    const save = vi.fn<(record: SubmissionRecord) => Promise<void>>().mockResolvedValue(undefined)
    await withServer(sendEmail, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/contact`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Customer', phone: '+919876543210', email: 'customer@example.com', message: 'Please call.' }),
      })
      expect(response.status).toBe(201)
      expect(await response.json()).toMatchObject({ ok: true, notificationStatus: emailStatus, whatsappNotificationStatus: whatsappStatus })
      expect(save).toHaveBeenCalledOnce()
      expect(sendEmail).toHaveBeenCalledOnce()
      expect(providerFetch).toHaveBeenCalledOnce()
      expect(save.mock.invocationCallOrder[0]).toBeLessThan(sendEmail.mock.invocationCallOrder[0])
      expect(save.mock.invocationCallOrder[0]).toBeLessThan(providerFetch.mock.invocationCallOrder[0])
    }, save)
  })

  it('does not attempt WhatsApp if saving the inquiry fails', async () => {
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', 'test-token')
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '123456')
    vi.stubEnv('WHATSAPP_OWNER_NUMBER', '919876543210')
    vi.stubEnv('WHATSAPP_TEMPLATE_NAME', 'new_enquiry')
    vi.stubEnv('WHATSAPP_TEMPLATE_LANGUAGE', 'en')
    vi.stubEnv('WHATSAPP_API_VERSION', 'v99.0')
    const nativeFetch = globalThis.fetch
    const providerFetch = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => String(input).startsWith('https://graph.facebook.com/')
      ? providerFetch(input, init) : nativeFetch(input, init))
    const sendEmail = vi.fn()
    const save = vi.fn<(record: SubmissionRecord) => Promise<void>>().mockRejectedValue(new Error('Database unavailable'))
    await withServer(sendEmail, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/contact`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Customer', phone: '+919876543210', message: 'Please call.' }),
      })
      expect(response.status).toBe(500)
      expect(sendEmail).not.toHaveBeenCalled()
      expect(providerFetch).not.toHaveBeenCalled()
    }, save)
  })

  it.each([
    ['465', true],
    ['587', false],
  ])('uses the real notification sender with SMTP port %s', async (port, secure) => {
    vi.stubEnv('SMTP_PORT', port)
    vi.stubEnv('MAIL_FROM', '')
    await withServer(undefined, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/contact`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Customer', phone: '+919876543210', message: 'Please call.' }),
      })
      expect(response.status).toBe(201)
      expect((await response.json()).notificationStatus).toBe('sent')
      expect(mailMocks.createTransport).toHaveBeenCalledWith(expect.objectContaining({
        host: 'smtp.example.com', port: Number(port), secure,
        auth: { user: 'owner@example.com', pass: 'test-app-password' },
      }))
      expect(mailMocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({
        from: 'owner@example.com', to: 'owner@example.com', subject: 'New website contact inquiry',
      }))
    })
  })

  it('uses the SMTP sender for a saved cart request with customer and product details', async () => {
    const save = vi.fn<(record: SubmissionRecord) => Promise<void>>().mockResolvedValue(undefined)
    await withServer(undefined, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/cart-leads`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer: orderBody.customer, items: orderBody.items }),
      })
      expect(response.status).toBe(201)
      expect((await response.json()).notificationStatus).toBe('sent')
      expect(mailMocks.sendMail).toHaveBeenCalledOnce()
      const message = mailMocks.sendMail.mock.calls[0][0]
      expect(message.text).toContain('Name: Test Customer')
      expect(message.text).toContain('Phone: +919876543210')
      expect(message.text).toContain('Email: customer@example.com')
      expect(message.text).toContain('Celeste Diamond Ring')
      expect(message.text).toContain('18K, quantity 2')
      expect(save.mock.invocationCallOrder[0]).toBeLessThan(mailMocks.sendMail.mock.invocationCallOrder[0])
    }, save)
  })

  it.each([
    [{ accepted: [], rejected: [] }],
    [{ accepted: ['owner@example.com'], rejected: ['other@example.com'] }],
    [{}],
  ])('does not report email success if SMTP did not accept all recipients', async (result) => {
    mailMocks.sendMail.mockResolvedValue(result)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const save = vi.fn<(record: SubmissionRecord) => Promise<void>>().mockResolvedValue(undefined)
    await withServer(undefined, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/contact`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Customer', phone: '+919876543210', message: 'Please call.' }),
      })
      expect(response.status).toBe(201)
      expect((await response.json()).notificationStatus).toBe('failed')
      expect(save).toHaveBeenCalledOnce()
    }, save)
  })

  it('emails complete order details after saving the order', async () => {
    const sendEmail = vi.fn().mockResolvedValue(undefined)
    const save = vi.fn<(record: SubmissionRecord) => Promise<void>>().mockResolvedValue(undefined)
    await withServer(sendEmail, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderBody),
      })
      const payload = await response.json()
      expect(response.status).toBe(201)
      expect(payload.notificationStatus).toBe('sent')
      expect(payload.orderId).toMatch(/^SYDJ-\d{4}-[A-F0-9]{8}$/)
      expect(sendEmail.mock.calls[0][0].text).toContain('Celeste Diamond Ring')
      expect(sendEmail.mock.calls[0][0].text).toContain('Diamond details:')
      expect(sendEmail.mock.calls[0][0].text).toContain('Gold type: 18K')
      expect(sendEmail.mock.calls[0][0].text).toContain('Quantity: 2')
      expect(sendEmail.mock.calls[0][0].text).toContain('10 Test Road, Delhi, Delhi, 110001')
      expect(save).toHaveBeenCalledWith(expect.objectContaining({
        type: 'order',
        orderId: payload.orderId,
        receivedAt: expect.any(String),
        items: [expect.objectContaining({ productName: 'Celeste Diamond Ring', goldPurity: '18K', quantity: 2 })],
      }))
    }, save)
  })

  it('saves a customer cart lead with selected products, purity, and quantity', async () => {
    const sendEmail = vi.fn().mockResolvedValue(undefined)
    const save = vi.fn<(record: SubmissionRecord) => Promise<void>>().mockResolvedValue(undefined)
    await withServer(sendEmail, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/cart-leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: { name: 'Test Customer', phone: '+919876543210', email: 'customer@example.com' },
          items: orderBody.items,
        }),
      })
      const payload = await response.json()
      expect(response.status).toBe(201)
      expect(payload.notificationStatus).toBe('sent')
      expect(payload.leadId).toBeTruthy()
      expect(save).toHaveBeenCalledWith(expect.objectContaining({
        type: 'cart',
        leadId: payload.leadId,
        receivedAt: expect.any(String),
        customer: expect.objectContaining({ name: 'Test Customer', phone: '+919876543210' }),
        items: [expect.objectContaining({ productId: 'celeste-diamond-ring', goldPurity: '18K', quantity: 2 })],
      }))
      expect(sendEmail.mock.calls[0][0].text).toContain('Customer requested contact')
    }, save)
  })

  it('keeps the submission accepted if email delivery fails', async () => {
    const sendEmail = vi.fn().mockRejectedValue(new Error('SMTP offline'))
    const save = vi.fn<(record: SubmissionRecord) => Promise<void>>().mockResolvedValue(undefined)
    await withServer(sendEmail, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderBody),
      })
      expect(response.status).toBe(201)
      const result = await response.json()
      expect(result.notificationStatus).toBe('failed')
      expect(save).toHaveBeenCalledOnce()
    }, save)
  })

  it.each([
    ['/api/contact', { name: 'Test Customer', phone: '+919876543210', message: 'Please call.' }, 'contact'],
    ['/api/cart-leads', { customer: orderBody.customer, items: orderBody.items }, 'cart_lead'],
    ['/api/orders', orderBody, 'order'],
  ])('logs safe SMTP failures without discarding %s', async (route, body, kind) => {
    const error = Object.assign(new Error('secret-password customer@example.com'), {
      code: 'EAUTH', command: 'AUTH', responseCode: 535, response: 'secret-password customer@example.com',
    })
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const save = vi.fn<(record: SubmissionRecord) => Promise<void>>().mockResolvedValue(undefined)
    await withServer(vi.fn().mockRejectedValue(error), async (baseUrl) => {
      const response = await fetch(`${baseUrl}${route}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      expect(response.status).toBe(201)
      const result = await response.json()
      expect(result.notificationStatus).toBe('failed')
      if (kind === 'contact') expect(result.whatsappNotificationStatus).toBe('not_configured')
      expect(save).toHaveBeenCalledOnce()
      expect(log).toHaveBeenCalledWith('Email notification failed:', {
        kind, code: 'EAUTH', command: 'AUTH', responseCode: 535,
      })
      expect(JSON.stringify(log.mock.calls)).not.toContain('secret-password')
      expect(JSON.stringify(log.mock.calls)).not.toContain('customer@example.com')
    }, save)
  })

  it.each([
    ['/api/contact', { name: 'Test Customer', phone: '+919876543210', message: 'Please call.' }],
    ['/api/cart-leads', { customer: orderBody.customer, items: orderBody.items }],
    ['/api/orders', orderBody],
  ])('does not report success or send email when saving %s fails', async (route, body) => {
    const sendEmail = vi.fn().mockResolvedValue(undefined)
    const save = vi.fn<(record: SubmissionRecord) => Promise<void>>().mockRejectedValue(new Error('Database unavailable'))
    await withServer(sendEmail, async (baseUrl) => {
      const response = await fetch(`${baseUrl}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      expect(response.status).toBe(500)
      expect((await response.json()).error).toContain('could not receive')
      expect(sendEmail).not.toHaveBeenCalled()
    }, save)
  })

  it('saves contact and order submissions and succeeds without SMTP credentials', async () => {
    vi.stubEnv('OWNER_EMAIL', '')
    vi.stubEnv('SMTP_HOST', '')
    vi.stubEnv('SMTP_USER', '')
    vi.stubEnv('SMTP_PASS', '')
    const sendEmail = vi.fn().mockResolvedValue(undefined)
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const save = vi.fn<(record: SubmissionRecord) => Promise<void>>().mockResolvedValue(undefined)

    await withServer(sendEmail, async (baseUrl) => {
      const contactResponse = await fetch(`${baseUrl}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Customer', phone: '+919876543210', email: '', message: 'Call me.' }),
      })
      const orderResponse = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderBody),
      })

      expect(contactResponse.status).toBe(201)
      expect((await contactResponse.json()).notificationStatus).toBe('not_configured')
      expect(orderResponse.status).toBe(201)
      expect((await orderResponse.json()).notificationStatus).toBe('not_configured')
      expect(save).toHaveBeenCalledTimes(2)
      expect(sendEmail).not.toHaveBeenCalled()
      expect(log).toHaveBeenCalledWith('Email notification not configured:', {
        kind: 'contact', missing: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'OWNER_EMAIL'],
      })
    }, save)
  })

  it('rejects invalid customer details and unavailable product purity', async () => {
    const sendEmail = vi.fn().mockResolvedValue(undefined)
    await withServer(sendEmail, async (baseUrl) => {
      const badCustomer = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...orderBody, customer: { ...orderBody.customer, phone: 'bad' } }),
      })
      const badPurity = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...orderBody, items: [{ productId: 'aarna-diamond-pendant', goldPurity: '14K', quantity: 1 }] }),
      })
      expect(badCustomer.status).toBe(400)
      expect(badPurity.status).toBe(400)
      expect(sendEmail).not.toHaveBeenCalled()
    })
  })

  it('allows localhost and 127.0.0.1 aliases locally but still rejects unrelated origins', async () => {
    vi.stubEnv('CLIENT_ORIGIN', 'http://localhost:4173')
    const save = vi.fn<(record: SubmissionRecord) => Promise<void>>().mockResolvedValue(undefined)
    await withServer(vi.fn().mockResolvedValue(undefined), async (baseUrl) => {
      const contact = { name: 'Test Customer', phone: '+919876543210', email: '', message: 'Please call.' }
      for (const origin of ['http://localhost:4173', 'http://127.0.0.1:4173']) {
        const response = await fetch(`${baseUrl}/api/contact`, {
          method: 'POST',
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body: JSON.stringify(contact),
        })
        expect(response.status).toBe(201)
      }

      const blocked = await fetch(`${baseUrl}/api/contact`, {
        method: 'POST',
        headers: { Origin: 'https://malicious.example', 'Content-Type': 'application/json' },
        body: JSON.stringify(contact),
      })
      expect(blocked.status).toBe(403)
      expect((await blocked.json()).error).toBe('This website is not allowed to use the API.')
      expect(save).toHaveBeenCalledTimes(2)
    }, save)
  })

  it('allows preflight for authorized cross-origin admin deletion', async () => {
    vi.stubEnv('CLIENT_ORIGIN', 'http://localhost:4173')
    await withServer(vi.fn(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/admin/orders/1`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:4173',
          'Access-Control-Request-Method': 'DELETE',
          'Access-Control-Request-Headers': 'authorization',
        },
      })
      expect(response.status).toBe(204)
      expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:4173')
      expect(response.headers.get('access-control-allow-methods')).toContain('DELETE')
      expect(response.headers.get('access-control-allow-headers')).toContain('Authorization')
    })
  })

  it('uses the singular origin when the plural setting contains only whitespace', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('CLIENT_ORIGINS', '   ')
    vi.stubEnv('CLIENT_ORIGIN', 'https://jewels.example.com')
    await withServer(vi.fn(), async (baseUrl) => {
      for (const [origin, status] of [['https://jewels.example.com', 400], ['https://other.example.com', 403]] as const) {
        const response = await fetch(`${baseUrl}/api/admin/login`, {
          method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}',
        })
        expect(response.status).toBe(status)
      }
    })
  })

  it('uses only CLIENT_ORIGINS when both origin settings are populated', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('CLIENT_ORIGINS', 'https://current.example.com')
    vi.stubEnv('CLIENT_ORIGIN', 'https://old.example.com')
    await withServer(vi.fn(), async (baseUrl) => {
      for (const [origin, status] of [['https://current.example.com', 400], ['https://old.example.com', 403]] as const) {
        const response = await fetch(`${baseUrl}/api/admin/login`, {
          method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}',
        })
        expect(response.status).toBe(status)
      }
    })
  })

  it('handles CORS before JSON parsing and keeps disallowed preflights blocked', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('CLIENT_ORIGINS', '')
    vi.stubEnv('CLIENT_ORIGIN', 'http://localhost:4173')
    await withServer(vi.fn(), async (baseUrl) => {
      const badJson = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST', headers: { Origin: 'http://localhost:4173', 'Content-Type': 'application/json' }, body: '{',
      })
      expect(badJson.status).toBe(400)
      expect(badJson.headers.get('access-control-allow-origin')).toBe('http://localhost:4173')
      const blocked = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' },
      })
      expect(blocked.status).toBe(403)
      expect(blocked.headers.get('access-control-allow-origin')).toBeNull()
    })
  })

  it('logs only safe request metadata for development origin checks', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('CLIENT_ORIGINS', '')
    vi.stubEnv('CLIENT_ORIGIN', 'http://localhost:4173')
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    await withServer(vi.fn(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/admin/login?secret=query-value`, {
        method: 'POST',
        headers: { Origin: 'https://user:secret@other.example', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@example.invalid', password: 'secret-password' }),
      })
      expect(response.status).toBe(403)
      expect(log).toHaveBeenCalledWith('Development origin check:', {
        method: 'POST', route: '/api/admin/login', origin: 'https://other.example', rejected: true,
      })
      expect(JSON.stringify(log.mock.calls)).not.toContain('secret')
    })
  })

  it('allows an explicitly configured list of production Vercel and custom-domain origins', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('CLIENT_ORIGINS', 'https://shree-yash.vercel.app, https://jewels.example.com/')
    const save = vi.fn<(record: SubmissionRecord) => Promise<void>>().mockResolvedValue(undefined)
    await withServer(vi.fn().mockResolvedValue(undefined), async (baseUrl) => {
      for (const origin of ['https://shree-yash.vercel.app', 'https://jewels.example.com']) {
        const response = await fetch(`${baseUrl}/api/contact`, {
          method: 'POST',
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Test Customer', phone: '+919876543210', email: '', message: 'Please call.' }),
        })
        expect(response.status).toBe(201)
        expect(response.headers.get('access-control-allow-origin')).toBe(origin)
      }
      const unlisted = await fetch(`${baseUrl}/api/contact`, {
        method: 'POST',
        headers: { Origin: 'https://other.vercel.app', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Customer', phone: '+919876543210', email: '', message: 'Please call.' }),
      })
      expect(unlisted.status).toBe(403)
      expect(save).toHaveBeenCalledTimes(2)
    }, save)
  })

  it('does not allow local origin aliases in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('CLIENT_ORIGIN', 'http://localhost:4173')
    await withServer(vi.fn().mockResolvedValue(undefined), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/contact`, {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:4173', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Customer', phone: '+919876543210', email: '', message: 'Please call.' }),
      })
      expect(response.status).toBe(403)
    })
  })
})
