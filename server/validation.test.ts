import { describe, expect, it } from 'vitest'
import { inquirySchema, orderSchema, visitorSchema } from './validation'

describe('request validation', () => {
  it('accepts visitor details without collecting sensitive data', () => {
    expect(visitorSchema.safeParse({
      sessionId: 'b2b9679c-b7f7-4fa8-b764-8a8e8495fe27',
      page: '/shop',
      device: 'Mobile browser',
      referrer: '',
    }).success).toBe(true)
  })

  it('requires the product and selected purity together on price inquiries', () => {
    const result = inquirySchema.safeParse({
      name: 'A Customer',
      phone: '+919876543210',
      email: '',
      productId: 'celeste-diamond-ring',
      goldPurity: '18K',
      message: '',
    })
    expect(result.success).toBe(true)
    expect(inquirySchema.safeParse({ name: 'A Customer', phone: '+919876543210', productId: 'ring' }).success).toBe(false)
  })

  it('rejects malformed order contact details and empty product lists', () => {
    expect(orderSchema.safeParse({ customer: {}, items: [] }).success).toBe(false)
  })
})