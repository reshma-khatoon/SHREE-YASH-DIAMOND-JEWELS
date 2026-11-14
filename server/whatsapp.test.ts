import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendContactWhatsApp } from './whatsapp'

const contact = {
  name: 'Test Customer',
  email: 'customer@example.test',
  phone: '+919876543210',
  message: 'Please\ncall me.',
}

describe('Meta WhatsApp contact notification', () => {
  beforeEach(() => {
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', 'test-token')
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '123456')
    vi.stubEnv('WHATSAPP_OWNER_NUMBER', '919876543210')
    vi.stubEnv('WHATSAPP_TEMPLATE_NAME', 'new_enquiry')
    vi.stubEnv('WHATSAPP_TEMPLATE_LANGUAGE', 'en')
    vi.stubEnv('WHATSAPP_API_VERSION', 'v99.0')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('sends the contact details in an approved template and requires a Meta message ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: 'wamid.test' }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await sendContactWhatsApp(contact)).toBe('sent')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://graph.facebook.com/v99.0/123456/messages')
    expect(options.headers.Authorization).toBe('Bearer test-token')
    expect(JSON.parse(options.body)).toEqual({
      messaging_product: 'whatsapp', to: '919876543210', type: 'template',
      template: {
        name: 'new_enquiry', language: { code: 'en' },
        components: [{ type: 'body', parameters: [
          { type: 'text', text: 'Test Customer' },
          { type: 'text', text: 'customer@example.test' },
          { type: 'text', text: '+919876543210' },
          { type: 'text', text: 'Please call me.' },
        ] }],
      },
    })
  })

  it('reports missing or invalid configuration without making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', '')
    expect(await sendContactWhatsApp(contact)).toBe('not_configured')
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', 'test-token')
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '../invalid')
    expect(await sendContactWhatsApp(contact)).toBe('failed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not truncate or send messages over 500 characters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: 'wamid.test' }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await sendContactWhatsApp({ ...contact, message: 'a'.repeat(500) })).toBe('sent')
    expect(await sendContactWhatsApp({ ...contact, message: 'a'.repeat(501) })).toBe('failed')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('reports provider, malformed response, and network failures without logging sensitive details', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 190, message: 'test-token customer@example.test' } }), { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockRejectedValueOnce(new Error('test-token customer@example.test'))
    vi.stubGlobal('fetch', fetchMock)
    expect(await sendContactWhatsApp(contact)).toBe('failed')
    expect(await sendContactWhatsApp(contact)).toBe('failed')
    expect(await sendContactWhatsApp(contact)).toBe('failed')
    const logs = JSON.stringify(vi.mocked(console.error).mock.calls)
    expect(logs).not.toContain('test-token')
    expect(logs).not.toContain('customer@example.test')
    expect(logs).toContain('190')
  })
})
