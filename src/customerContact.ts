export type CustomerTable = 'inquiries' | 'orders' | 'cart_leads'
export type CustomerRecord = {
  id: number
  created_at: string
  admin_status: 'new' | 'read' | 'replied'
  contact_status: 'new' | 'contacted' | 'follow-up' | 'closed'
  follow_up_date: string | null
  last_contact_at: string | null
  last_contact_method: string | null
  [key: string]: unknown
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function customerLinks(table: CustomerTable, record: CustomerRecord) {
  const customer = table === 'inquiries' ? record
    : typeof record.customer === 'object' && record.customer !== null ? record.customer as Record<string, unknown> : {}
  const name = text(customer.name) || 'Customer'
  const phone = text(customer.phone)
  const email = text(customer.email)
  const digits = phone.replace(/\D/g, '')
  const validPhone = /^\+?[0-9 ()-]+$/.test(phone) && digits.length >= 7 && digits.length <= 15
  let whatsapp = ''
  if (validPhone) {
    if (/^[6-9]\d{9}$/.test(digits)) whatsapp = `91${digits}`
    else if (/^0[6-9]\d{9}$/.test(digits)) whatsapp = `91${digits.slice(1)}`
    else if (/^91[6-9]\d{9}$/.test(digits)) whatsapp = digits
    else if (phone.startsWith('+') && /^[1-9]\d{7,14}$/.test(digits)) whatsapp = digits
    else if (digits.startsWith('00') && /^[1-9]\d{7,14}$/.test(digits.slice(2))) whatsapp = digits.slice(2)
  }
  const items = Array.isArray(record.items) ? record.items.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return []
    const entry = item as Record<string, unknown>
    const product = text(entry.productName)
    if (!product) return []
    return [`${product}${text(entry.goldPurity) ? ` (${text(entry.goldPurity)})` : ''}${typeof entry.quantity === 'number' ? ` × ${entry.quantity}` : ''}`]
  }) : []
  const product = text(record.product_name)
  const inquiry = text(record.message)
  const context = table === 'inquiries'
    ? [product && `Product: ${product}${text(record.gold_purity) ? ` (${text(record.gold_purity)})` : ''}`, inquiry && `Your enquiry: ${inquiry}`].filter(Boolean).join('\n')
    : [table === 'orders' ? `Order: ${text(record.order_id)}` : 'Your saved cart', items.length ? `Items: ${items.join(', ')}` : ''].filter(Boolean).join('\n')
  const message = `Dear ${name},\n\nThank you for contacting Shree Yash Diamond & Jewels.\n${context ? `\n${context}\n` : ''}\nPlease let us know how we may assist you.\n\nWarm regards,\nShree Yash Diamond & Jewels`
  const subject = table === 'orders' ? `Your order with Shree Yash Diamond & Jewels` : table === 'cart_leads'
    ? 'Your saved jewellery cart' : 'Your jewellery enquiry'
  return {
    call: validPhone ? `tel:${phone.startsWith('+') ? '+' : ''}${digits}` : '',
    whatsapp: whatsapp ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}` : '',
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}` : '',
  }
}
