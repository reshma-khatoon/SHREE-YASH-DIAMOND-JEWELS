import { randomBytes } from 'node:crypto'
import { Router } from 'express'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { supabase } from './supabase'

const tableNames = ['inquiries', 'orders', 'cart_leads'] as const
type TableName = typeof tableNames[number]
type AdminStatus = 'new' | 'read' | 'replied'
type Session = { accessToken: string; userId: string; expiresAt: number }
type AdminDependencies = {
  signIn: (email: string, password: string) => Promise<{ accessToken: string; userId: string; email: string; expiresAt: number } | null>
  getUser: (accessToken: string) => Promise<{ userId: string; email: string } | null>
  isAdminEmail: (email: string) => Promise<boolean>
  signOut: (accessToken: string) => Promise<void>
  list: (table: TableName, offset: number) => Promise<unknown[]>
  update: (table: TableName, id: number, status: AdminStatus) => Promise<boolean>
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
    if (!data.session || !data.session.expires_at || !data.user.email) {
      throw new Error('Supabase authentication returned no session or email')
    }
    return {
      accessToken: data.session.access_token,
      userId: data.user.id,
      email: data.user.email,
      expiresAt: data.session.expires_at * 1000,
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
  allowedUserIds: () => (process.env.ADMIN_USER_IDS || '').split(',').map((id) => id.trim()).filter(Boolean),
}

const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(1024) })
const statusSchema = z.object({ status: z.enum(['new', 'read', 'replied']) }).strict()
const tableSchema = z.enum(tableNames)
const idSchema = z.coerce.number().int().positive().safe()
const offsetSchema = z.coerce.number().int().min(0).max(100000).default(0)

export function createAdminRouter(deps: AdminDependencies = defaultDependencies) {
  const router = Router()
  const sessions = new Map<string, Session>()
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
    const now = Date.now()
    for (const [token, session] of sessions) if (session.expiresAt <= now) sessions.delete(token)
    if (sessions.size >= 100) {
      await deps.signOut(auth.accessToken)
      res.status(503).json({ error: 'Too many active admin sessions.' })
      return
    }
    const token = randomBytes(32).toString('base64url')
    sessions.set(token, { ...auth, expiresAt: Math.min(auth.expiresAt, now + 60 * 60 * 1000) })
    res.json({ token })
  })

  router.use(async (req, res, next) => {
    const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.get('Authorization') || '')
    const token = match?.[1]
    const session = token ? sessions.get(token) : undefined
    if (!token || !session || session.expiresAt <= Date.now()) {
      if (token) sessions.delete(token)
      res.status(401).json({ error: 'Please log in again.' })
      return
    }
    const user = await deps.getUser(session.accessToken)
    if (!user
      || user.userId !== session.userId
      || !deps.allowedUserIds().includes(user.userId)
      || !await deps.isAdminEmail(user.email)) {
      sessions.delete(token)
      res.status(401).json({ error: 'Please log in again.' })
      return
    }
    res.locals.adminToken = token
    res.locals.adminSession = session
    next()
  })

  router.get('/session', (_req, res) => {
    res.json({ ok: true })
  })

  router.post('/logout', async (_req, res) => {
    const token: string = res.locals.adminToken
    const session: Session = res.locals.adminSession
    sessions.delete(token)
    await deps.signOut(session.accessToken)
    res.json({ ok: true })
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
  return router
}
