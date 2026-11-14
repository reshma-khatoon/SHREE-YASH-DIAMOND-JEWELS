import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminRequest, AdminRequestError } from './adminApi'

describe('admin API response handling', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows a useful error when a deployment returns HTML instead of JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('The page could not be found', { status: 404 })))
    await expect(adminRequest('/login')).rejects.toMatchObject({
      message: 'The admin API returned an invalid response (404). Check the API deployment.',
      status: 0,
    })
  })

  it('preserves the status and message of JSON authorization errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'Please log in again.' }, { status: 401 })))
    await expect(adminRequest('/session')).rejects.toMatchObject({
      message: 'Please log in again.',
      status: 401,
    })
  })

  it('reports network errors without exposing raw browser exceptions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection failed')))
    await expect(adminRequest('/session')).rejects.toBeInstanceOf(AdminRequestError)
    await expect(adminRequest('/session')).rejects.toThrow('Cannot reach the admin API.')
  })
})
