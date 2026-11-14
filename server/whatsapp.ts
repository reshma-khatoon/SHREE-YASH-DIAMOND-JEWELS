import type { z } from 'zod'
import type { contactSchema } from './validation.js'

type Contact = z.infer<typeof contactSchema>
type WhatsAppStatus = 'sent' | 'not_configured' | 'failed'

function templateText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

export async function sendContactWhatsApp(contact: Contact): Promise<WhatsAppStatus> {
  const names = [
    'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_OWNER_NUMBER',
    'WHATSAPP_TEMPLATE_NAME', 'WHATSAPP_TEMPLATE_LANGUAGE', 'WHATSAPP_API_VERSION',
  ] as const
  const missing = names.filter((name) => !process.env[name]?.trim())
  if (missing.length) {
    console.warn('WhatsApp notification not configured:', { missing })
    return 'not_configured'
  }

  const token = process.env.WHATSAPP_ACCESS_TOKEN!.trim()
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID!.trim()
  const recipient = process.env.WHATSAPP_OWNER_NUMBER!.trim()
  const template = process.env.WHATSAPP_TEMPLATE_NAME!.trim()
  const language = process.env.WHATSAPP_TEMPLATE_LANGUAGE!.trim()
  const version = process.env.WHATSAPP_API_VERSION!.trim()
  if (!/^\d+$/.test(phoneId) || !/^[1-9]\d{6,14}$/.test(recipient)
    || !/^[a-z0-9_]+$/.test(template) || !/^[a-zA-Z0-9_-]+$/.test(language)
    || !/^v\d+\.\d+$/.test(version)) {
    console.error('WhatsApp notification failed:', { reason: 'invalid_configuration' })
    return 'failed'
  }

  const message = templateText(contact.message) || 'Please contact me about this jewellery item.'
  if (message.length > 500) {
    console.error('WhatsApp notification failed:', { reason: 'message_too_long' })
    return 'failed'
  }

  const parameters = [
    templateText(contact.name), templateText(contact.email) || 'Not provided',
    templateText(contact.phone), message,
  ].map((text) => ({ type: 'text', text }))

  try {
    const response = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'template',
        template: {
          name: template,
          language: { code: language },
          components: [{ type: 'body', parameters }],
        },
      }),
      signal: AbortSignal.timeout(8000),
    })
    const data: unknown = await response.json()
    if (!response.ok) {
      const error = typeof data === 'object' && data !== null && 'error' in data ? data.error : undefined
      const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'number'
        ? error.code : undefined
      console.error('WhatsApp notification failed:', { httpStatus: response.status, code })
      return 'failed'
    }
    if (typeof data !== 'object' || data === null || !('messages' in data)
      || !Array.isArray(data.messages) || typeof data.messages[0]?.id !== 'string' || !data.messages[0].id) {
      console.error('WhatsApp notification failed:', { reason: 'invalid_response' })
      return 'failed'
    }
    return 'sent'
  } catch {
    console.error('WhatsApp notification failed:', { reason: 'request_or_response_error' })
    return 'failed'
  }
}
