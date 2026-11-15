import { Router } from 'express'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { supabase } from './supabase.js'

const tableNames = ['inquiries', 'orders', 'cart_leads'] as const
type TableName = typeof tableNames[number]
type AdminStatus = 'new' | 'read' | 'replied'
type AdminCounts = {
  inquiries: { total: number; new: number }
  orders: { total: number; new: number }
  cartLeads: { total: number; new: number }
}
type AdminDependencies = {
  signIn: (email: string, password: string) => Promise<{ accessToken: string; refreshToken: string; userId: string; email: string } | null>
  getUser: (accessToken: string) => Promise<{ userId: string; email: string } | null>
  isAdminEmail: (email: string) => Promise<boolean>
  signOut: (accessToken: string) => Promise<void>
  counts: () => Promise<AdminCounts>
  list: (table: TableName, offset: number) => Promise<unknown[]>
  update: (table: TableName, id: number, status: AdminStatus) => Promise<boolean>
  remove: (table: TableName, id: number) => Promise<boolean>
  allowedUserIds: () => string[]
}

function authClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required for admin login')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
}

const defaultDependencies: AdminDependencies = {
  async signIn(email, password) {
    const { data, error } = await authClient().auth.signInWithPassword({ email, password })
    if (error) {
      if (error.status === 400 || error.status === 401) return null
      throw new Error(`Supabase authentication failed: ${error.message}`)
    }
    if (!data.session?.access_token || !data.session.refresh_token || !data.user.email) {
      throw new Error('Supabase authentication returned no session or email')
    }
    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      userId: data.user.id,
      email: data.user.email,
    }
  },
  async getUser(accessToken) {
    const { data, error } = await supabase.auth.getUser(accessToken)
    if (error) {
      if (error.status === 400 || error.status === 401 || error.status === 403) return null
      throw new Error(`Supabase session verification failed: ${error.message}`)
    }
    if (!data.user?.email) return null
    return { userId: data.user.id, email: data.user.email }
  },
  async isAdminEmail(email) {
    const { data, error } = await supabase.from('admins').select('email')
    if (error) throw new Error(`Could not verify admin account: ${error.message}`)
    return data.some((admin) => typeof admin.email === 'string' && admin.email.trim().toLowerCase() === email.trim().toLowerCase())
  },
  async signOut(accessToken) {
    const { error } = await supabase.auth.admin.signOut(accessToken, 'local')
    if (error) throw new Error(`Supabase logout failed: ${error.message}`)
  },
  async counts() {
    async function count(table: TableName, onlyNew = false): Promise<number> {
      const query = supabase.from(table).select('id', { count: 'exact', head: true })
      const { count, error } = await (onlyNew ? query.eq('admin_status', 'new') : query)
      if (error) throw new Error(`Could not count ${table}: ${error.message}`)
      if (count === null || !Number.isSafeInteger(count) || count < 0) {
        throw new Error(`Could not count ${table}: Supabase returned an invalid count`)
      }
      return count
    }

    const [inquiries, newInquiries, orders, newOrders, cartLeads, newCartLeads] = await Promise.all([
      count('inquiries'), count('inquiries', true),
      count('orders'), count('orders', true), count('cart_leads'), count('cart_leads', true),
    ])
    return {
      inquiries: { total: inquiries, new: newInquiries },
      orders: { total: orders, new: newOrders },
      cartLeads: { total: cartLeads, new: newCartLeads },
    }
  },
  async list(table, offset) {
    const { data, error } = await supabase.from(table).select('*,admin_status')
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 49)
    if (error) throw new Error(`Could not load ${table}: ${error.message}`)
    return data
  },
  async update(table, id, status) {
    const { data, error } = await supabase.from(table).update({ admin_status: status }).eq('id', id).select('id')
    if (error) throw new Error(`Could not update ${table}: ${error.message}`)
    return data.length === 1
  },
  async remove(table, id) {
    const { data, error } = await supabase.from(table).delete().eq('id', id).select('id')
    if (error) throw new Error(`Could not delete ${table} record: ${error.message}`)
    return data.length === 1
  },
  allowedUserIds: () => (process.env.ADMIN_USER_IDS || '').split(',').map((id) => id.trim()).filter(Boolean),
}

const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(1024) })
const statusSchema = z.object({ status: z.enum(['new', 'read', 'replied']) }).strict()
const tableSchema = z.enum(tableNames)
const idSchema = z.coerce.number().int().positive().safe()
const offsetSchema = z.coerce.number().int().min(0).max(100000).default(0)

export function createAdminRouter(deps: AdminDependencies = defaultDependencies) {
  const router = Router()
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    next()
  })

  router.post('/login', async (req, res) => {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Enter a valid email and password.' })
      return
    }
    if (deps.allowedUserIds().length === 0) {
      res.status(503).json({ error: 'Admin access is not configured.' })
      return
    }
    const auth = await deps.signIn(parsed.data.email, parsed.data.password)
    if (!auth) {
      res.status(401).json({ error: 'Invalid credentials or unauthorized account.' })
      return
    }
    if (!deps.allowedUserIds().includes(auth.userId) || !await deps.isAdminEmail(auth.email)) {
      await deps.signOut(auth.accessToken)
      res.status(403).json({ error: 'Invalid credentials or unauthorized account.' })
      return
    }
    res.json({ token: auth.accessToken, refreshToken: auth.refreshToken })
  })

  router.use(async (req, res, next) => {
    const match = /^Bearer ([^\s]{1,8192})$/.exec(req.get('Authorization') || '')
    const token = match?.[1]
    if (!token) {
      res.status(401).json({ error: 'Please log in again.' })
      return
    }
    const user = await deps.getUser(token)
    if (!user
      || !deps.allowedUserIds().includes(user.userId)
      || !await deps.isAdminEmail(user.email)) {
      res.status(401).json({ error: 'Please log in again.' })
      return
    }
    res.locals.adminToken = token
    next()
  })

  router.get('/session', (_req, res) => {
    res.json({ ok: true })
  })

  router.post('/logout', async (_req, res) => {
    const token: string = res.locals.adminToken
    await deps.signOut(token)
    res.json({ ok: true })
  })

  router.get('/counts', async (_req, res) => {
    res.json(await deps.counts())
  })

  router.get('/:table', async (req, res) => {
    const table = tableSchema.safeParse(req.params.table)
    const offset = offsetSchema.safeParse(req.query.offset)
    if (!table.success || !offset.success) {
      res.status(400).json({ error: 'Invalid table or page.' })
      return
    }
    res.json({ records: await deps.list(table.data, offset.data) })
  })

  router.patch('/:table/:id/status', async (req, res) => {
    const table = tableSchema.safeParse(req.params.table)
    const id = idSchema.safeParse(req.params.id)
    const body = statusSchema.safeParse(req.body)
    if (!table.success || !id.success || !body.success) {
      res.status(400).json({ error: 'Invalid record or status.' })
      return
    }
    if (!await deps.update(table.data, id.data, body.data.status)) {
      res.status(404).json({ error: 'Record not found.' })
      return
    }
    res.json({ ok: true })
  })

  router.delete('/:table/:id', async (req, res) => {
    const table = tableSchema.safeParse(req.params.table)
    const id = idSchema.safeParse(req.params.id)
    if (!table.success || !id.success) {
      res.status(400).json({ error: 'Invalid record.' })
      return
    }
    if (!await deps.remove(table.data, id.data)) {
      res.status(404).json({ error: 'Record not found.' })
      return
    }
    res.json({ ok: true })
  })
  return router
}
