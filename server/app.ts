import { randomUUID } from 'node:crypto'
import express from 'express'
import nodemailer from 'nodemailer'
import { products } from '../src/data'
import { saveSubmission, type SubmissionRecord } from './submissions'
import { contactSchema, orderSchema } from './validation'

type EmailMessage = { subject: string; text: string }
type EmailSender = (message: EmailMessage) => Promise<void>
type SubmissionSaver = (record: SubmissionRecord) => Promise<void>

type NotificationStatus = 'sent' | 'not_configured' | 'failed'

function isAllowedOrigin(origin: string, configuredOrigin: string) {
  if (origin === configuredOrigin) return true
  if (process.env.NODE_ENV === 'production') return false

  try {
    const requestOrigin = new URL(origin)
    const expectedOrigin = new URL(configuredOrigin)
    const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
    return requestOrigin.protocol === 'http:'
      && expectedOrigin.protocol === 'http:'
      && requestOrigin.port === expectedOrigin.port
      && loopbackHosts.has(requestOrigin.hostname)
      && loopbackHosts.has(expectedOrigin.hostname)
  } catch {
    return false
  }
}

function emailIsConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.OWNER_EMAIL)
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
  }).then(() => undefined)
}

function formatDate(date: Date) {
  return date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })
}

export function createApp(sendEmail: EmailSender = sendNotificationEmail, save: SubmissionSaver = saveSubmission) {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '20kb' }))

  app.use((request, response, next) => {
    const origin = request.headers.origin
    const allowedOrigin = process.env.CLIENT_ORIGIN
    if (origin && allowedOrigin && !isAllowedOrigin(origin, allowedOrigin)) {
      response.status(403).json({ error: 'This website is not allowed to use the API.' })
      return
    }
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin)
      response.setHeader('Vary', 'Origin')
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    }
    if (request.method === 'OPTIONS') {
      response.sendStatus(204)
      return
    }
    next()
  })

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

    const notificationStatus = await notifyOwner(sendEmail, { subject, text })
    response.status(201).json({ ok: true, notificationStatus, message: 'Your message has been received.' })
  }

  app.post('/api/contact', contactHandler)

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

    const notificationStatus = await notifyOwner(sendEmail, { subject: `New jewellery order ${orderId}`, text })
    response.status(201).json({ ok: true, orderId, notificationStatus, message: 'Your order has been received successfully.' })
  })

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof SyntaxError && 'body' in error) {
      response.status(400).json({ error: 'Please submit valid JSON.' })
      return
    }
    console.error('Could not save submission:', error)
    response.status(500).json({ error: 'We could not receive your request. Please try again or contact us by phone.' })
  })

  return app
}

async function notifyOwner(sendEmail: EmailSender, message: EmailMessage): Promise<NotificationStatus> {
  if (!emailIsConfigured()) return 'not_configured'
  try {
    await sendEmail(message)
    return 'sent'
  } catch (error) {
    console.error('Email notification failed:', error)
    return 'failed'
  }
}
