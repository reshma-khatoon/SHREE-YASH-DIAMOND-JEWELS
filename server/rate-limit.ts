import { createHash } from 'node:crypto'
import { getDatabase } from './database'
import { ApiError, getClientAddress } from './http'
import type { VercelRequest } from './vercel-handler-types'

export async function enforceRateLimit(request: VercelRequest, scope: string, limit: number, windowSeconds: number) {
  const salt = process.env.RATE_LIMIT_SALT
  if (!salt) throw new Error('rate_limit_salt_not_configured')
  const address = getClientAddress(request)
  const keyHash = createHash('sha256')
    .update(`${salt}:${scope}:${address}`)
    .digest('hex')
  const now = Date.now()
  const windowStart = new Date(Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000).toISOString()
  const { data, error } = await getDatabase().rpc('consume_rate_limit', {
    p_key_hash: keyHash,
    p_bucket_start: windowStart,
    p_limit: limit,
  })

  if (error) throw error
  if (data !== true) throw new ApiError(429, 'Too many requests. Please wait and try again.')
}