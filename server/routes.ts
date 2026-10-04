import { randomUUID } from 'node:crypto'
import { products } from '../src/data'
import { getDatabase } from './database'
import { ApiError, idempotencyKey, requestBody } from './http'
import { dispatchNotifications } from './notifications'
import { enforceRateLimit } from './rate-limit'
import { inquirySchema, orderSchema, visitorSchema } from './validation'
import type { VercelRequest, VercelResponse } from './vercel-handler-types'

function validated<T>(schema: { safeParse: (value: unknown) => { success: boolean; data?: T } }, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success || !parsed.data) throw new ApiError(400, 'Please check the information and try again.')
  return parsed.data
}

function getReferrerOrigin(value: string) {
  if (!value) return ''
  try {
    const referrer = new URL(value)
    return referrer.protocol === 'http:' || referrer.protocol === 'https:' ? referrer.origin : ''
  } catch {
    return ''
  }
}

function localDateTime(date: Date) {
  return date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })
}

export async function handleNewVisitor(request: VercelRequest, response: VercelResponse) {
  await enforceRateLimit(request, 'visitors', 120, 60)
  const visitor = validated(visitorSchema, requestBody(request))
  const database = getDatabase()
  const visitedAt = new Date()
  const referrer = getReferrerOrigin(visitor.referrer)
  const sessionInsert = await database.from('visitor_sessions').insert({
    session_id: visitor.sessionId,
    first_page: visitor.page,
    device: visitor.device,
    referrer,
    created_at: visitedAt.toISOString(),
  })
  let isNewVisitor = !sessionInsert.error
  if (sessionInsert.error && sessionInsert.error.code !== '23505') throw sessionInsert.error

  const { error: pageViewError } = await database.from('visitor_pageviews').insert({
    session_id: visitor.sessionId,
    page_path: visitor.page,
    device: visitor.device,
    referrer,
    visited_at: visitedAt.toISOString(),
  })
  if (pageViewError) throw pageViewError

  if (isNewVisitor) {
    const pageTitle = visitor.page.slice(0, 200)
    const emailText = [
      'New Website Visitor – Shree Yash Diamond & Jewels',
      '',
      `Date & Time: ${localDateTime(visitedAt)}`,
      `Page visited: ${pageTitle}`,
      `Device: ${visitor.device || 'Not available'}`,
      `Source/referrer: ${referrer || 'Direct / not available'}`,
    ].join('\n')
    const visitorSmsEnabled = process.env.VISITOR_SMS_ENABLED === 'true'
    const visitorWhatsAppEnabled = process.env.VISITOR_WHATSAPP_ENABLED === 'true'
    await dispatchNotifications({
      eventType: 'visitor',
      eventId: visitor.sessionId,
      subject: 'New Website Visitor – Shree Yash Diamond & Jewels',
      emailText,
      shortText: `New visitor. ${pageTitle}. ${localDateTime(visitedAt)}.`,
    }, { sms: visitorSmsEnabled, whatsapp: visitorWhatsAppEnabled })
  }

  response.status(200).json({ ok: true, newVisitor: isNewVisitor })
}

export async function handleNewInquiry(request: VercelRequest, response: VercelResponse, priceInquiry = false) {
  await enforceRateLimit(request, 'inquiries', 5, 3600)
  const inquiry = validated(inquirySchema, requestBody(request))
  if (!priceInquiry && !inquiry.message) throw new ApiError(400, 'Please include a message with your inquiry.')
  const requestKey = idempotencyKey(request)

  let product: (typeof products)[number] | undefined
  if (inquiry.productId) {
    product = products.find((item) => item.id === inquiry.productId)
    if (!product || !product.availablePurities?.includes(inquiry.goldPurity!)) {
      throw new ApiError(400, 'That product or gold purity is not available.')
    }
  }

  const database = getDatabase()
  const createdAt = new Date()
  const insert = await database.from('inquiries').insert({
    idempotency_key: requestKey,
    customer_name: inquiry.name,
    customer_phone: inquiry.phone,
    customer_email: inquiry.email || null,
    message: inquiry.message || null,
    product_id: product?.id ?? null,
    product_name: product?.name ?? null,
    gold_purity: inquiry.goldPurity ?? null,
    created_at: createdAt.toISOString(),
  }).select('id').single()

  if (insert.error?.code === '23505') {
    const existing = await database.from('inquiries').select('id').eq('idempotency_key', requestKey).single()
    if (existing.error) throw existing.error
    response.status(200).json({ ok: true, inquiryId: existing.data.id, duplicate: true })
    return
  }
  if (insert.error) throw insert.error

  const title = priceInquiry ? 'New Price Inquiry – Shree Yash Diamond & Jewels' : 'New Customer Inquiry – Shree Yash Diamond & Jewels'
  const emailText = [
    title,
    '',
    `Name: ${inquiry.name}`,
    `Phone: ${inquiry.phone}`,
    `Email: ${inquiry.email || 'Not provided'}`,
    ...(product ? [`Product: ${product.name}`, `Gold Purity: ${inquiry.goldPurity} Gold`] : []),
    `Message: ${inquiry.message || 'Please share the latest price and available customization options.'}`,
    `Time: ${localDateTime(createdAt)}`,
  ].join('\n')
  const shortText = product
    ? `New price inquiry: ${inquiry.name}, ${inquiry.phone}, ${product.name}, ${inquiry.goldPurity} Gold.`
    : `New customer inquiry: ${inquiry.name}, ${inquiry.phone}. ${inquiry.message.slice(0, 180)}`

  const notificationStatus = await dispatchNotifications({
    eventType: 'inquiry',
    eventId: insert.data.id,
    subject: title,
    emailText,
    shortText,
  })
  response.status(201).json({ ok: true, inquiryId: insert.data.id, notificationStatus })
}

export async function handleNewOrder(request: VercelRequest, response: VercelResponse) {
  await enforceRateLimit(request, 'orders', 5, 3600)
  const order = validated(orderSchema, requestBody(request))
  const requestKey = idempotencyKey(request)
  const orderItems = order.items.map((item) => {
    const product = products.find((entry) => entry.id === item.productId)
    if (!product || !product.availablePurities?.includes(item.goldPurity)) {
      throw new ApiError(400, 'A product or gold purity in this order is not available.')
    }
    return { productId: product.id, productName: product.name, goldPurity: item.goldPurity, quantity: item.quantity }
  })

  const database = getDatabase()
  const createdAt = new Date()
  const orderId = `SY-${createdAt.toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 8).toUpperCase()}`
  const totalAmount = 'To be confirmed (Price on Request)'
  const insert = await database.from('orders').insert({
    idempotency_key: requestKey,
    order_id: orderId,
    customer_name: order.customer.name,
    customer_phone: order.customer.phone,
    customer_email: order.customer.email || null,
    delivery_address: [order.customer.address, order.customer.city, order.customer.state, order.customer.pincode].join(', '),
    items: orderItems,
    total_amount: totalAmount,
    created_at: createdAt.toISOString(),
  }).select('order_id').single()

  if (insert.error?.code === '23505') {
    const existing = await database.from('orders').select('order_id').eq('idempotency_key', requestKey).single()
    if (existing.error) throw existing.error
    response.status(200).json({ ok: true, orderId: existing.data.order_id, duplicate: true })
    return
  }
  if (insert.error) throw insert.error

  const productsText = orderItems.map((item) => `${item.productName} (${item.productId}), ${item.goldPurity} Gold`).join('\n')
  const quantity = orderItems.reduce((sum, item) => sum + item.quantity, 0)
  const address = [order.customer.address, order.customer.city, order.customer.state, order.customer.pincode].join(', ')
  const emailText = [
    'New Order Received – Shree Yash Diamond & Jewels',
    '',
    `Customer Name: ${order.customer.name}`,
    `Customer Phone: ${order.customer.phone}`,
    `Customer Email: ${order.customer.email || 'Not provided'}`,
    `Order ID: ${orderId}`,
    `Products: ${productsText}`,
    `Quantity: ${quantity}`,
    `Total Amount: ${totalAmount}`,
    `Delivery Address: ${address}`,
    `Order Date & Time: ${localDateTime(createdAt)}`,
  ].join('\n')
  const shortText = `New order ${orderId}: ${order.customer.name}, ${order.customer.phone}, ${orderItems.length} product line(s), quantity ${quantity}. Price to be confirmed.`
  const notificationStatus = await dispatchNotifications({
    eventType: 'order',
    eventId: orderId,
    subject: 'New Order Received – Shree Yash Diamond & Jewels',
    emailText,
    shortText,
  })

  response.status(201).json({ ok: true, orderId, notificationStatus })
}