import nodemailer from 'nodemailer'
import twilio from 'twilio'
import { getDatabase } from './database'

export type NotificationResult = {
  channel: 'email' | 'sms' | 'whatsapp'
  status: 'sent' | 'skipped' | 'failed'
  errorCode: string | null
}

type NotificationEvent = {
  eventType: 'visitor' | 'inquiry' | 'order'
  eventId: string
  subject: string
  emailText: string
  shortText: string
}

function configuredEmail() {
  const required = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'OWNER_EMAIL'] as const
  if (required.some((key) => !process.env[key])) return null
  const port = Number(process.env.SMTP_PORT ?? 587)
  return {
    to: process.env.OWNER_EMAIL!,
    transport: nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE === 'true' || port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 7000,
    }),
    from: process.env.MAIL_FROM || process.env.SMTP_USER!,
  }
}

export async function sendEmailNotification(subject: string, text: string) {
  const config = configuredEmail()
  if (!config) throw new Error('email_not_configured')
  await config.transport.sendMail({
    from: config.from,
    to: config.to,
    subject,
    text,
    html: `<pre style="font:14px/1.6 Arial,sans-serif;white-space:pre-wrap">${escapeHtml(text)}</pre>`,
  })
}

export function sendInquiryEmail(text: string, subject = 'New Customer Inquiry – Shree Yash Diamond & Jewels') {
  return sendEmailNotification(subject, text)
}

export function sendOrderEmail(text: string) {
  return sendEmailNotification('New Order Received – Shree Yash Diamond & Jewels', text)
}

export function sendVisitorEmail(text: string) {
  return sendEmailNotification('New Website Visitor – Shree Yash Diamond & Jewels', text)
}

export async function sendSMSNotification(text: string) {
  const { OWNER_PHONE, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER } = process.env
  if (!OWNER_PHONE || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) throw new Error('sms_not_configured')
  await twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN).messages.create({
    body: text.slice(0, 1500),
    from: TWILIO_PHONE_NUMBER,
    to: OWNER_PHONE,
  })
}

export async function sendWhatsAppNotification(text: string) {
  const { OWNER_WHATSAPP, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, TWILIO_WHATSAPP_CONTENT_SID } = process.env
  if (!OWNER_WHATSAPP || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM || !TWILIO_WHATSAPP_CONTENT_SID) throw new Error('whatsapp_not_configured')
  const asWhatsAppAddress = (value: string) => value.startsWith('whatsapp:') ? value : `whatsapp:${value}`
  await twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN).messages.create({
    from: asWhatsAppAddress(TWILIO_WHATSAPP_FROM),
    to: asWhatsAppAddress(OWNER_WHATSAPP),
    contentSid: TWILIO_WHATSAPP_CONTENT_SID,
    contentVariables: JSON.stringify({ '1': text.slice(0, 900) }),
  })
}

export async function dispatchNotifications(event: NotificationEvent, options: { sms?: boolean; whatsapp?: boolean } = {}): Promise<NotificationResult[]> {
  const attempts: Array<{ channel: NotificationResult['channel']; send: () => Promise<void> }> = [
    { channel: 'email', send: () => event.eventType === 'visitor' ? sendVisitorEmail(event.emailText) : event.eventType === 'inquiry' ? sendInquiryEmail(event.emailText, event.subject) : sendOrderEmail(event.emailText) },
  ]
  if (options.sms !== false) attempts.push({ channel: 'sms', send: () => sendSMSNotification(event.shortText) })
  if (options.whatsapp !== false) attempts.push({ channel: 'whatsapp', send: () => sendWhatsAppNotification(event.shortText) })

  const results = await Promise.all(attempts.map(async ({ channel, send }): Promise<NotificationResult> => {
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        send(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('provider_timeout')), 5000)
        }),
      ])
      return { channel, status: 'sent', errorCode: null }
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      return { channel, status: code.endsWith('_not_configured') ? 'skipped' : 'failed', errorCode: code.endsWith('_not_configured') ? code : 'provider_unavailable' }
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }))

  try {
    const rows = results.map((result) => ({
      event_type: event.eventType,
      event_id: event.eventId,
      channel: result.channel,
      status: result.status,
      error_code: result.errorCode,
    }))
    const { error } = await getDatabase().from('notification_deliveries').upsert(rows, { onConflict: 'event_type,event_id,channel' })
    if (error) throw error
  } catch {
    console.error(JSON.stringify({ eventType: event.eventType, eventId: event.eventId, code: 'notification_log_write_failed' }))
  }

  return results
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}