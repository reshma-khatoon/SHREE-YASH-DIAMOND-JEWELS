import { describe, expect, it } from 'vitest'
import { customerLinks, type CustomerRecord } from './customerContact'

const inquiry: CustomerRecord = {
  id: 1, created_at: '2026-01-01', admin_status: 'new', contact_status: 'new',
  follow_up_date: null, last_contact_at: null, last_contact_method: null,
  name: 'Asha & family', phone: '+91 98765 43210', email: 'asha@example.test',
  product_name: 'Gold & Diamond Ring', gold_purity: '18K', message: 'Price?',
}

describe('customer communication links', () => {
  it.each(['9876543210', '09876543210', '919876543210', '+91 98765 43210', '00919876543210'])(
    'normalizes Indian phone %s without duplicating the country code', (phone) => {
      expect(customerLinks('inquiries', { ...inquiry, phone }).whatsapp).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/)
    },
  )
  it('builds encoded, personalized links without sending a message', () => {
    const links = customerLinks('inquiries', inquiry)
    expect(links.call).toBe('tel:+919876543210')
    const url = new URL(links.whatsapp)
    expect(url.searchParams.get('text')).toContain('Dear Asha & family')
    expect(url.searchParams.get('text')).toContain('Gold & Diamond Ring (18K)')
    expect(url.searchParams.get('text')).toContain('Price?')
    const email = new URL(links.email)
    expect(email.pathname).toBe('asha%40example.test')
    expect(email.searchParams.get('subject')).toContain('enquiry')
    expect(email.searchParams.get('body')).toContain('Dear Asha & family')
  })
  it('includes order and cart items and handles missing or invalid contacts', () => {
    const record = { ...inquiry, customer: { name: 'Riya', phone: '', email: '' }, order_id: 'SYDJ-1',
      items: [{ productName: 'Necklace', goldPurity: '22K', quantity: 2 }] }
    const links = customerLinks('orders', record)
    expect(links).toEqual({ call: '', whatsapp: '', email: '' })
    const cart = customerLinks('cart_leads', { ...record, customer: { name: 'Riya', phone: '+44 7700 900123', email: 'x@example.test' } })
    expect(decodeURIComponent(cart.whatsapp)).toContain('Necklace (22K) × 2')
    expect(cart.whatsapp).toMatch(/^https:\/\/wa\.me\/447700900123\?/)
    expect(customerLinks('inquiries', { ...inquiry, phone: '123abc', email: 'bad\n@example.test' })).toEqual({ call: '', whatsapp: '', email: '' })
  })
})
