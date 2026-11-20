import { randomUUID } from 'node:crypto'
import express from 'express'
import nodemailer from 'nodemailer'
import { products } from '../src/data.js'
import { createAdminRouter } from './admin.js'
import { saveSubmission, type SubmissionRecord } from './submissions.js'
import { cartLeadSchema, contactSchema, orderSchema } from './validation.js'
import { sendContactWhatsApp } from './whatsapp.js'

type EmailMessage = { subject: string; text: string }
type NotificationKind = 'contact' | 'cart_lead' | 'order'
type EmailSender = (message: EmailMessage) => Promise<void>
type SubmissionSaver = (record: SubmissionRecord) => Promise<void>

type NotificationStatus = 'sent' | 'not_configured' | 'failed'

function normalizeOrigin(origin: string) {
  try {
    return new URL(origin).origin
  } catch {
    return ''
  }
}

function isAllowedOrigin(origin: string, configuredOrigins: string[]) {
  const normalizedOrigin = normalizeOrigin(origin)
  if (!normalizedOrigin) return false
  if (configuredOrigins.some((configuredOrigin) => normalizeOrigin(configuredOrigin) === normalizedOrigin)) return true
  if (process.env.NODE_ENV === 'production') return false

  const requestOrigin = new URL(normalizedOrigin)
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
  return requestOrigin.protocol === 'http:'
    && configuredOrigins.some((configuredOrigin) => {
      try {
        const expectedOrigin = new URL(configuredOrigin)
        return expectedOrigin.protocol === 'http:'
          && requestOrigin.port === expectedOrigin.port
          && loopbackHosts.has(requestOrigin.hostname)
          && loopbackHosts.has(expectedOrigin.hostname)
      } catch {
        return false
      }
    })
}

function sendNotificationEmail({ subject, text }: EmailMessage) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, OWNER_EMAIL } = process.env
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !OWNER_EMAIL) {
    throw new Error('Email is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, and OWNER_EMAIL.')
  }

  const port = Number(SMTP_PORT || 587)
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  })

  return transporter.sendMail({
    from: process.env.MAIL_FROM || SMTP_USER,
    to: OWNER_EMAIL,
    subject,
    text,
  }).then((result) => {
    if (!Array.isArray(result.accepted) || result.accepted.length === 0
      || !Array.isArray(result.rejected) || result.rejected.length > 0) {
      throw Object.assign(new Error('SMTP did not accept all recipients.'), { code: 'EMESSAGE' })
    }
  })
}

function formatDate(date: Date) {
  return date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })
}

export function createApp(sendEmail: EmailSender = sendNotificationEmail, save: SubmissionSaver = saveSubmission) {
  const app = express()
  app.disable('x-powered-by')

  app.use((request, response, next) => {
    const origin = request.headers.origin
    const configuredOrigins = (process.env.CLIENT_ORIGINS?.trim() || process.env.CLIENT_ORIGIN || '')
      .split(',')
      .map((configuredOrigin) => configuredOrigin.trim())
      .filter(Boolean)
    const rejected = Boolean(origin && (configuredOrigins.length === 0 && process.env.NODE_ENV === 'production'
      || configuredOrigins.length > 0 && !isAllowedOrigin(origin, configuredOrigins)))
    // Temporary development diagnostics: never log headers, bodies, or full URLs.
    if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test'
      && (rejected || request.path === '/api/admin/login')) {
      const safeOrigin = origin ? normalizeOrigin(origin) || '(invalid)' : '(none)'
      const route = request.path === '/api/admin/login' ? '/api/admin/login' : '(other)'
      console.info('Development origin check:', { method: request.method, route, origin: safeOrigin, rejected })
    }
    if (rejected) {
      response.status(403).json({ error: 'This website is not allowed to use the API.' })
      return
    }
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin)
      response.setHeader('Vary', 'Origin')
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    }
    if (request.method === 'OPTIONS') {
      response.sendStatus(204)
      return
    }
    next()
  })

  app.use(express.json({ limit: '20kb' }))

  app.use('/api/admin', createAdminRouter())

  const contactHandler: express.RequestHandler = async (request, response, next) => {
    const parsed = contactSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Please check your name, phone, email, and message.' })
      return
    }

    const contact = parsed.data
    const createdAt = new Date()
    const subject = 'New website contact inquiry'
    const text = [
      'New customer inquiry — Shree Yash Diamond & Jewels',
      '',
      `Name: ${contact.name}`,
      `Phone: ${contact.phone}`,
      `Email: ${contact.email || 'Not provided'}`,
      ...(contact.productName ? [`Product: ${contact.productName}`, `Gold type: ${contact.goldPurity}`] : []),
      `Message: ${contact.message || 'Please contact me about this jewellery item.'}`,
      `Date/time: ${formatDate(createdAt)} (Asia/Kolkata)`,
    ].join('\n')

    try {
      await save({ type: 'contact', receivedAt: createdAt.toISOString(), ...contact })
    } catch (error) {
      next(error)
      return
    }

    const [notificationStatus, whatsappNotificationStatus] = await Promise.all([
      notifyOwner('contact', sendEmail, { subject, text }),
      sendContactWhatsApp(contact),
    ])
    response.status(201).json({
      ok: true, notificationStatus, whatsappNotificationStatus, message: 'Your message has been received.',
    })
  }

  app.post('/api/contact', contactHandler)

  app.post('/api/cart-leads', async (request, response, next) => {
    const parsed = cartLeadSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Please enter your name and phone number and check the cart items.' })
      return
    }

    const cartLead = parsed.data
    const items = cartLead.items.map((item) => {
      const product = products.find((entry) => entry.id === item.productId)
      if (!product || !product.availablePurities?.includes(item.goldPurity)) return null
      return { product, goldPurity: item.goldPurity, quantity: item.quantity }
    })
    if (items.some((item) => item === null)) {
      response.status(400).json({ error: 'A product or gold type in your cart is not available.' })
      return
    }

    const validItems = items.filter((item): item is NonNullable<typeof item> => item !== null)
    const receivedAt = new Date()
    const leadId = randomUUID()
    const itemLines = validItems.map(({ product, goldPurity, quantity }) =>
      `${product.name} (${product.id}) — ${goldPurity}, quantity ${quantity}`).join('\n')
    const text = [
      'Customer requested contact about their jewellery cart.',
      '',
      `Name: ${cartLead.customer.name}`,
      `Phone: ${cartLead.customer.phone}`,
      `Email: ${cartLead.customer.email || 'Not provided'}`,
      '',
      'Cart:',
      itemLines,
      `Date/time: ${formatDate(receivedAt)} (Asia/Kolkata)`,
    ].join('\n')

    try {
      await save({
        type: 'cart',
        leadId,
        receivedAt: receivedAt.toISOString(),
        customer: cartLead.customer,
        items: validItems.map(({ product, goldPurity, quantity }) => ({
          productId: product.id,
          productName: product.name,
          productImage: product.image,
          category: product.category,
          goldPurity,
          quantity,
        })),
      })
    } catch (error) {
      next(error)
      return
    }

    const notificationStatus = await notifyOwner('cart_lead', sendEmail, {
      subject: 'Customer wants to be contacted about their cart',
      text,
    })
    response.status(201).json({ ok: true, leadId, notificationStatus, message: 'Your cart details have been saved.' })
  })

  app.post('/api/orders', async (request, response, next) => {
    const parsed = orderSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Please check your contact details, address, and selected products.' })
      return
    }

    const order = parsed.data
    const items = order.items.map((item) => {
      const product = products.find((entry) => entry.id === item.productId)
      if (!product || !product.availablePurities?.includes(item.goldPurity)) return null
      return {
        product,
        goldPurity: item.goldPurity,
        quantity: item.quantity,
      }
    })
    if (items.some((item) => item === null)) {
      response.status(400).json({ error: 'A product or gold type in your order is not available.' })
      return
    }

    const validItems = items.filter((item): item is NonNullable<typeof item> => item !== null)
    const orderId = `SYDJ-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`
    const createdAt = new Date()
    const itemLines = validItems.map(({ product, goldPurity, quantity }, index) => [
      `Item ${index + 1}: ${product.name} (${product.id})`,
      `Category: ${product.category}`,
      `Image: ${product.image}`,
      `Details: ${product.description}`,
      `Material: ${product.material}`,
      `Diamond details: ${product.diamondDetails}`,
      `Gold type: ${goldPurity}`,
      `Quantity: ${quantity}`,
    ].join('\n')).join('\n\n')
    const text = [
      'New order — Shree Yash Diamond & Jewels',
      '',
      `Order ID: ${orderId}`,
      `Customer: ${order.customer.name}`,
      `Phone: ${order.customer.phone}`,
      `Email: ${order.customer.email || 'Not provided'}`,
      `WhatsApp: ${order.customer.whatsapp || 'Not provided'}`,
      `Address: ${[order.customer.address, order.customer.city, order.customer.state, order.customer.pincode].join(', ')}`,
      '',
      itemLines,
      '',
      'Price: To be confirmed (Price on Request)',
      `Order date/time: ${formatDate(createdAt)} (Asia/Kolkata)`,
    ].join('\n')

    try {
      await save({
        type: 'order',
        receivedAt: createdAt.toISOString(),
        orderId,
        customer: order.customer,
        items: validItems.map(({ product, goldPurity, quantity }) => ({
          productId: product.id,
          productName: product.name,
          productImage: product.image,
          category: product.category,
          details: product.description,
          material: product.material,
          diamondDetails: product.diamondDetails,
          goldPurity,
          quantity,
        })),
        priceStatus: 'Price on Request',
      })
    } catch (error) {
      next(error)
      return
    }

    const notificationStatus = await notifyOwner('order', sendEmail, { subject: `New jewellery order ${orderId}`, text })
    response.status(201).json({ ok: true, orderId, notificationStatus, message: 'Your order has been received successfully.' })
  })

  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'API route not found.' })
  })

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof SyntaxError && 'body' in error) {
      response.status(400).json({ error: 'Please submit valid JSON.' })
      return
    }
    if (error instanceof Error && 'status' in error && error.status === 413) {
      response.status(413).json({ error: 'Request body is too large.' })
      return
    }
    console.error('API request failed:', error)
    response.status(500).json({ error: _request.path.startsWith('/api/admin')
      ? 'Admin request failed. Please try again.'
      : 'We could not receive your request. Please try again or contact us by phone.' })
  })

  return app
}

async function notifyOwner(kind: NotificationKind, sendEmail: EmailSender, message: EmailMessage): Promise<NotificationStatus> {
  const missing = (['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'OWNER_EMAIL'] as const)
    .filter((name) => !process.env[name])
  if (missing.length) {
    console.warn('Email notification not configured:', { kind, missing })
    return 'not_configured'
  }
  try {
    await sendEmail(message)
    return 'sent'
  } catch (error) {
    const codes = ['EAUTH', 'ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ETLS', 'EENVELOPE', 'EMESSAGE', 'ECONFIG', 'ESTREAM']
    const commands = ['CONN', 'AUTH', 'MAIL FROM', 'RCPT TO', 'DATA']
    const details = typeof error === 'object' && error !== null ? error : {}
    const code = 'code' in details && typeof details.code === 'string' && codes.includes(details.code) ? details.code : 'OTHER'
    const command = 'command' in details && typeof details.command === 'string' && commands.includes(details.command)
      ? details.command : undefined
    const responseCode = 'responseCode' in details && typeof details.responseCode === 'number'
      && Number.isInteger(details.responseCode) && details.responseCode >= 100 && details.responseCode <= 599
      ? details.responseCode : undefined
    console.error('Email notification failed:', { kind, code, command, responseCode })
    return 'failed'
  }
}
const app = createApp()

export default app