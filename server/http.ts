import type { VercelRequest, VercelResponse } from './vercel-handler-types'

export class ApiError extends Error {
  constructor(readonly status: number, readonly publicMessage: string) {
    super(publicMessage)
  }
}

export type ApiHandler = (request: VercelRequest, response: VercelResponse) => Promise<void>

function allowedOrigins() {
  const configured = (process.env.CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean)
  const siteOrigin = process.env.SITE_ORIGIN
  const vercelOrigin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined
  const localOrigin = process.env.NODE_ENV === 'production' ? undefined : 'http://localhost:4173'
  return new Set([...configured, siteOrigin, vercelOrigin, localOrigin].filter(Boolean))
}

export function apiHandler(handler: ApiHandler): ApiHandler {
  return async (request, response) => {
    const origin = request.headers.origin
    const requestId = crypto.randomUUID()

    if (origin && !allowedOrigins().has(origin)) {
      response.status(403).json({ ok: false, error: 'Request origin is not allowed.' })
      return
    }

    if (origin) response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key')
    response.setHeader('Cache-Control', 'no-store')

    if (request.method === 'OPTIONS') {
      response.status(204).end()
      return
    }

    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST, OPTIONS')
      response.status(405).json({ ok: false, error: 'Method not allowed.' })
      return
    }

    try {
      await handler(request, response)
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 500
      if (status >= 500) {
        const knownCodes = new Set(['database_not_configured', 'rate_limit_salt_not_configured'])
        const code = error instanceof Error && knownCodes.has(error.message) ? error.message : 'internal_error'
        console.error(JSON.stringify({ requestId, status, code }))
      }
      response.status(status).json({
        ok: false,
        error: error instanceof ApiError ? error.publicMessage : 'We could not process your request. Please try again shortly.',
        requestId,
      })
    }
  }
}

export function requestBody(request: VercelRequest): unknown {
  const contentLength = Number(request.headers['content-length'] ?? 0)
  if (contentLength > 20_000) throw new ApiError(413, 'Request is too large.')
  const contentType = request.headers['content-type']
  if (typeof contentType !== 'string' || !contentType.toLowerCase().includes('application/json')) {
    throw new ApiError(415, 'Please submit the form again.')
  }
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
    throw new ApiError(400, 'Please submit a valid request.')
  }
  return request.body
}

export function idempotencyKey(request: VercelRequest): string {
  const value = request.headers['idempotency-key']
  const key = Array.isArray(value) ? value[0] : value
  if (!key || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    throw new ApiError(400, 'Please retry submitting the form.')
  }
  return key
}

export function getClientAddress(request: VercelRequest): string {
  const trustedAddress = request.ip
  if (trustedAddress) return trustedAddress
  const forwarded = request.headers['x-forwarded-for']
  const address = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]
  return address?.trim() || 'unknown'
}