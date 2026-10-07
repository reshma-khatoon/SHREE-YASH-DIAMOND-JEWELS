import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createApp } from './app'
import { saveSubmission, type SubmissionRecord } from './submissions'

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
  sendEmail: (message: { subject: string; text: string }) => Promise<void>,
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
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
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
      expect((await response.json()).ok).toBe(true)
      expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
        subject: expect.stringContaining('contact'),
        text: expect.stringContaining('Please call me.'),
      }))
      expect(sendEmail.mock.calls[0][0].text).toContain('Date/time:')
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
      expect((await response.json()).notificationStatus).toBe('failed')
      expect(save).toHaveBeenCalledOnce()
    }, save)
  })

  it('saves contact and order submissions and succeeds without SMTP credentials', async () => {
    vi.stubEnv('OWNER_EMAIL', '')
    vi.stubEnv('SMTP_HOST', '')
    vi.stubEnv('SMTP_USER', '')
    vi.stubEnv('SMTP_PASS', '')
    const sendEmail = vi.fn().mockResolvedValue(undefined)
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
    }, save)
  })

  it('persists accepted submissions to the configured local JSONL file', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'shree-yash-api-'))
    const submissionsFile = path.join(directory, 'submissions.jsonl')
    vi.stubEnv('SUBMISSIONS_FILE', submissionsFile)
    const sendEmail = vi.fn().mockResolvedValue(undefined)
    const save = (record: SubmissionRecord) => saveSubmission(record)

    try {
      await withServer(sendEmail, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(orderBody),
        })
        expect(response.status).toBe(201)
      }, save)

      const savedLines = (await readFile(submissionsFile, 'utf8')).trim().split('\n')
      expect(savedLines).toHaveLength(1)
      expect(JSON.parse(savedLines[0])).toEqual(expect.objectContaining({
        type: 'order',
        customer: expect.objectContaining({ name: 'Test Customer' }),
        items: [expect.objectContaining({ productName: 'Celeste Diamond Ring', goldPurity: '18K', quantity: 2 })],
      }))
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
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
