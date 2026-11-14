import { beforeEach, describe, expect, it, vi } from 'vitest'
import { saveSubmission, type SubmissionRecord } from './submissions'

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  from: vi.fn(),
}))

vi.mock('./supabase', () => ({ supabase: { from: mocks.from } }))

const receivedAt = '2026-01-02T03:04:05.000Z'
const customer = { name: 'Test Customer', phone: '+919876543210', email: '' }
const item = {
  productId: 'ring',
  productName: 'Ring',
  productImage: 'ring.jpg',
  category: 'rings',
  goldPurity: '18K' as const,
  quantity: 2,
}

describe('Supabase submission storage', () => {
  beforeEach(() => {
    mocks.from.mockReset().mockReturnValue({ insert: mocks.insert })
    mocks.insert.mockReset().mockResolvedValue({ error: null })
  })

  it('stores contact and product enquiry details in inquiries', async () => {
    await saveSubmission({
      type: 'contact', receivedAt, ...customer, message: '',
      productId: 'ring', productName: 'Ring', goldPurity: '18K',
    })
    expect(mocks.from).toHaveBeenCalledWith('inquiries')
    expect(mocks.insert).toHaveBeenCalledWith({
      name: customer.name, phone: customer.phone, email: null, message: '',
      product_id: 'ring', product_name: 'Ring', gold_purity: '18K', created_at: receivedAt,
    })
    await saveSubmission({ type: 'contact', receivedAt, ...customer, message: 'Please call' })
    expect(mocks.insert).toHaveBeenLastCalledWith({
      name: customer.name, phone: customer.phone, email: null, message: 'Please call',
      product_id: null, product_name: null, gold_purity: null, created_at: receivedAt,
    })
  })

  it('stores cart customer and enriched items in cart_leads', async () => {
    await saveSubmission({ type: 'cart', receivedAt, leadId: 'lead-1', customer, items: [item] })
    expect(mocks.from).toHaveBeenCalledWith('cart_leads')
    expect(mocks.insert).toHaveBeenCalledWith({
      lead_id: 'lead-1', customer, items: [item], created_at: receivedAt,
    })
  })

  it('stores the order customer, address, items and price status in orders', async () => {
    const orderCustomer = { ...customer, whatsapp: '', address: '10 Test Road', city: 'Delhi', state: 'Delhi', pincode: '110001' }
    const orderItem = { ...item, details: 'details', material: 'gold', diamondDetails: 'diamond' }
    await saveSubmission({
      type: 'order', receivedAt, orderId: 'order-1', customer: orderCustomer,
      items: [orderItem], priceStatus: 'Price on Request',
    })
    expect(mocks.from).toHaveBeenCalledWith('orders')
    expect(mocks.insert).toHaveBeenCalledWith({
      order_id: 'order-1', customer: orderCustomer, items: [orderItem],
      price_status: 'Price on Request', created_at: receivedAt,
    })
  })

  it.each<SubmissionRecord>([
    { type: 'contact', receivedAt, ...customer, message: '' },
    { type: 'cart', receivedAt, leadId: 'lead-1', customer, items: [item] },
    {
      type: 'order', receivedAt, orderId: 'order-1',
      customer: { ...customer, whatsapp: '', address: '10 Test Road', city: 'Delhi', state: 'Delhi', pincode: '110001' },
      items: [{ ...item, details: 'details', material: 'gold', diamondDetails: 'diamond' }],
      priceStatus: 'Price on Request',
    },
  ])('propagates database errors for $type', async (record) => {
    mocks.insert.mockResolvedValue({ error: { message: 'Database unavailable' } })
    await expect(saveSubmission(record)).rejects.toThrow('Database unavailable')
  })
})
