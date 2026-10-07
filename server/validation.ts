import { z } from 'zod'

const phoneSchema = z.string().trim().min(7).max(24)
  .regex(/^\+?[0-9 ()-]+$/)
  .refine((value) => value.replace(/\D/g, '').length >= 7 && value.replace(/\D/g, '').length <= 15)

const cartLeadItemSchema = z.object({
  productId: z.string().trim().min(1).max(120),
  goldPurity: z.enum(['14K', '18K', '22K']),
  quantity: z.number().int().min(1).max(50),
})

export const cartLeadSchema = z.object({
  customer: z.object({
    name: z.string().trim().min(2).max(120),
    phone: phoneSchema,
    email: z.union([z.string().trim().email().max(254), z.literal('')]).optional().default(''),
  }),
  items: z.array(cartLeadItemSchema).min(1).max(30),
})

export const contactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: phoneSchema,
  email: z.union([z.string().trim().email().max(254), z.literal('')]).optional().default(''),
  message: z.string().trim().max(5000).optional().default(''),
  productId: z.string().trim().max(120).optional(),
  productName: z.string().trim().max(200).optional(),
  goldPurity: z.enum(['14K', '18K', '22K']).optional(),
})

export const orderSchema = z.object({
  customer: z.object({
    name: z.string().trim().min(2).max(120),
    phone: phoneSchema,
    email: z.union([z.string().trim().email().max(254), z.literal('')]).optional().default(''),
    whatsapp: z.string().trim().max(24).optional().default(''),
    address: z.string().trim().min(5).max(500),
    city: z.string().trim().min(2).max(100),
    state: z.string().trim().min(2).max(100),
    pincode: z.string().trim().min(4).max(12).regex(/^[0-9 -]+$/),
  }),
  items: z.array(cartLeadItemSchema).min(1).max(30),
})
