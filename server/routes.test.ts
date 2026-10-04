import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rows: {
    visitor_sessions: [] as Array<Record<string, unknown>>,
    visitor_pageviews: [] as Array<Record<string, unknown>>,
    inquiries: [] as Array<Record<string, unknown>>,
    orders: [] as Array<Record<string, unknown>>,
  },
  dispatch: vi.fn(),
  rateLimit: vi.fn(),
}))

vi.mock('./rate-limit', () => ({ enforceRateLimit: mocks.rateLimit }))
vi.mock('./notifications', () => ({ dispatchNotifications: mocks.dispatch }))
vi.mock('./database', () => ({
  getDatabase: () => ({
    from(table: keyof typeof mocks.rows) {
      let inserted: Record<string, unknown> | undefined
      const filters: Array<[string, unknown]> = []
      const builder: any = {
        insert(value: Record<string, unknown>) {
          inserted = value
          return builder
        },
        select() {
          return builder
        },
        eq(column: string, value: unknown) {
          filters.push([column, value])
          return builder
        },
        single() {
          if (inserted) return commit()
          const row = mocks.rows[table].find((candidate) => filters.every(([column, value]) => candidate[column] === value))
          return row ? { data: row, error: null } : { data: null, error: { code: 'PGRST116' } }
        },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve(commit()).then(resolve, reject)
        },
      }
      function commit() {
        const row = inserted ?? {}
        const uniqueColumn = table === 'visitor_sessions' ? 'session_id' : table === 'inquiries' || table === 'orders' ? 'idempotency_key' : ''
        if (uniqueColumn && mocks.rows[table].some((candidate) => candidate[uniqueColumn] === row[uniqueColumn])) {
          return { data: null, error: { code: '23505' } }
        }
        const saved = { ...row, id: `${table}-test-id` }
        mocks.rows[table].push(saved)
        return { data: saved, error: null }
      }
      return builder
    },
  }),
}))

import { handleNewInquiry, handleNewOrder, handleNewVisitor } from './routes'
import type { VercelRequest, VercelResponse } from './vercel-handler-types'

function makeRequest(body: unknown, key?: string) {
  return {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      ...(key ? { 'idempotency-key': key } : {}),
    },
  } as unknown as VercelRequest
}

function makeResponse() {
  const result: { statusCode: number; body?: any } = { statusCode: 200 }
  const response = {
    status(code: number) {
      result.statusCode = code
      return response
    },
    json(body: unknown) {
      result.body = body
      return response
    },
  }
  return { result, response: response as unknown as VercelResponse }
}

const validOrder = {
  customer: {
    name: 'Test Customer',
    phone: '+919876543210',
    email: 'customer@example.com',
    address: '10 Test Road',
    city: 'Delhi',
    state: 'Delhi',
    pincode: '110001',
  },
  items: [{ productId: 'celeste-diamond-ring', goldPurity: '18K', quantity: 1 }],
}

describe('notification API routes', () => {
  beforeEach(() => {
    Object.values(mocks.rows).forEach((rows) => rows.splice(0))
    mocks.dispatch.mockReset().mockResolvedValue([])
    mocks.rateLimit.mockReset().mockResolvedValue(undefined)
  })

  it('stores each visitor page but notifies only once per session', async () => {
    const body = {
      sessionId: 'b2b9679c-b7f7-4fa8-b764-8a8e8495fe27',
      page: '/shop',
      device: 'Test browser',
      referrer: '',
    }
    const first = makeResponse()
    const second = makeResponse()

    await handleNewVisitor(makeRequest(body) as VercelRequest, first.response)
    await handleNewVisitor(makeRequest({ ...body, page: '/contact' }) as VercelRequest, second.response)

    expect(first.result.body.newVisitor).toBe(true)
    expect(second.result.body.newVisitor).toBe(false)
    expect(mocks.rows.visitor_sessions).toHaveLength(1)
    expect(mocks.rows.visitor_pageviews).toHaveLength(2)
    expect(mocks.dispatch).toHaveBeenCalledOnce()
  })

  it('saves an order before notifying and returns the same order for a retry', async () => {
    mocks.dispatch.mockImplementationOnce(async () => {
      expect(mocks.rows.orders).toHaveLength(1)
      return [{ channel: 'whatsapp', status: 'failed', errorCode: 'provider_unavailable' }]
    })
    const first = makeResponse()
    const retry = makeResponse()
    const key = 'b2b9679c-b7f7-4fa8-b764-8a8e8495fe27'

    await handleNewOrder(makeRequest(validOrder, key), first.response)
    await handleNewOrder(makeRequest(validOrder, key), retry.response)

    expect(first.result.statusCode).toBe(201)
    expect(first.result.body.orderId).toMatch(/^SY-/)
    expect(retry.result.statusCode).toBe(200)
    expect(retry.result.body.orderId).toBe(first.result.body.orderId)
    expect(retry.result.body.duplicate).toBe(true)
    expect(mocks.rows.orders).toHaveLength(1)
    expect(mocks.dispatch).toHaveBeenCalledOnce()
  })

  it('accepts price inquiries without a message and persists the selected purity', async () => {
    const result = makeResponse()
    const key = 'b2b9679c-b7f7-4fa8-b764-8a8e8495fe27'

    await handleNewInquiry(makeRequest({
      name: 'Test Customer',
      phone: '+919876543210',
      email: '',
      productId: 'celeste-diamond-ring',
      goldPurity: '22K',
      message: '',
    }, key), result.response, true)

    expect(result.result.statusCode).toBe(201)
    expect(mocks.rows.inquiries[0].gold_purity).toBe('22K')
    expect(mocks.dispatch).toHaveBeenCalledOnce()
  })
})