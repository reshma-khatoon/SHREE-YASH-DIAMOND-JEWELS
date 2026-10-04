import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(),
  sendMessage: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: mocks.sendMail })) },
}))

vi.mock('twilio', () => ({
  default: vi.fn(() => ({ messages: { create: mocks.sendMessage } })),
}))

vi.mock('./database', () => ({
  getDatabase: () => ({ from: () => ({ upsert: mocks.upsert }) }),
}))

import { dispatchNotifications } from './notifications'

const event = {
  eventType: 'inquiry' as const,
  eventId: 'inquiry-test-1',
  subject: 'New Customer Inquiry – Shree Yash Diamond & Jewels',
  emailText: 'Name: Test Customer',
  shortText: 'New inquiry from Test Customer.',
}

const providerEnvironment = {
  OWNER_EMAIL: 'owner@example.com',
  OWNER_PHONE: '+919999999999',
  OWNER_WHATSAPP: '+919999999999',
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_PORT: '465',
  SMTP_SECURE: 'true',
  SMTP_USER: 'owner@example.com',
  SMTP_PASS: 'test-app-password',
  TWILIO_ACCOUNT_SID: 'AC00000000000000000000000000000000',
  TWILIO_AUTH_TOKEN: 'test-auth-token',
  TWILIO_PHONE_NUMBER: '+10000000000',
  TWILIO_WHATSAPP_FROM: 'whatsapp:+10000000000',
  TWILIO_WHATSAPP_CONTENT_SID: 'HX00000000000000000000000000000000',
}

describe('notification dispatch', () => {
  beforeEach(() => {
    for (const [key, value] of Object.entries(providerEnvironment)) vi.stubEnv(key, value)
    mocks.sendMail.mockReset().mockResolvedValue({ messageId: 'mail-test' })
    mocks.sendMessage.mockReset().mockResolvedValue({ sid: 'message-test' })
    mocks.upsert.mockReset().mockResolvedValue({ error: null })
  })

  afterEach(() => vi.unstubAllEnvs())

  it('attempts email and SMS even when WhatsApp fails, and records channel statuses', async () => {
    mocks.sendMessage.mockImplementation(async ({ to }: { to: string }) => {
      if (to.startsWith('whatsapp:')) throw new Error('provider unavailable')
      return { sid: 'sms-test' }
    })

    const results = await dispatchNotifications(event)

    expect(results.map(({ channel, status }) => [channel, status])).toEqual([
      ['email', 'sent'],
      ['sms', 'sent'],
      ['whatsapp', 'failed'],
    ])
    expect(mocks.sendMail).toHaveBeenCalledOnce()
    expect(mocks.sendMessage).toHaveBeenCalledTimes(2)
    expect(mocks.upsert).toHaveBeenCalledOnce()
  })

  it('uses an approved WhatsApp content template instead of exposing frontend automation', async () => {
    await dispatchNotifications(event)

    const whatsappCall = mocks.sendMessage.mock.calls.find(([message]) => message.to.startsWith('whatsapp:'))?.[0]
    expect(whatsappCall.contentSid).toBe(providerEnvironment.TWILIO_WHATSAPP_CONTENT_SID)
    expect(JSON.parse(whatsappCall.contentVariables)).toEqual({ '1': event.shortText })
  })

  it('does not throw when notification credentials are not configured', async () => {
    for (const key of Object.keys(providerEnvironment)) vi.stubEnv(key, '')

    const results = await dispatchNotifications(event)

    expect(results.map((result) => result.status)).toEqual(['skipped', 'skipped', 'skipped'])
  })
})