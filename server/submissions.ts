import type { z } from 'zod'
import { supabase } from './supabase'
import type { cartLeadSchema, contactSchema, orderSchema } from './validation'

type CartItem = {
  productId: string
  productName: string
  productImage: string
  category: string
  goldPurity: '14K' | '18K' | '22K'
  quantity: number
}

type OrderItem = CartItem & {
  details: string
  material: string
  diamondDetails: string
}

export type SubmissionRecord =
  | ({ type: 'contact'; receivedAt: string } & z.infer<typeof contactSchema>)
  | {
    type: 'cart'
    receivedAt: string
    leadId: string
    customer: z.infer<typeof cartLeadSchema>['customer']
    items: CartItem[]
  }
  | {
    type: 'order'
    receivedAt: string
    orderId: string
    customer: z.infer<typeof orderSchema>['customer']
    items: OrderItem[]
    priceStatus: string
  }

export async function saveSubmission(record: SubmissionRecord): Promise<void> {
  let result
  switch (record.type) {
    case 'contact':
      result = await supabase.from('inquiries').insert({
        name: record.name,
        phone: record.phone,
        email: record.email || null,
        message: record.message,
        product_id: record.productId ?? null,
        product_name: record.productName ?? null,
        gold_purity: record.goldPurity ?? null,
        created_at: record.receivedAt,
      })
      break
    case 'cart':
      result = await supabase.from('cart_leads').insert({
        lead_id: record.leadId,
        customer: record.customer,
        items: record.items,
        created_at: record.receivedAt,
      })
      break
    case 'order':
      result = await supabase.from('orders').insert({
        order_id: record.orderId,
        customer: record.customer,
        items: record.items,
        price_status: record.priceStatus,
        created_at: record.receivedAt,
      })
      break
  }
  if (result.error) {
    throw new Error(`Could not save ${record.type} submission to Supabase: ${result.error.message}`)
  }
}
