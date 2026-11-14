const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? ''

export class AdminRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export async function adminRequest<T>(path: string, token?: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}/api/admin${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store',
    })
  } catch {
    throw new AdminRequestError('Cannot reach the admin API. Please check the connection and try again.', 0)
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new AdminRequestError(`The admin API returned an invalid response (${response.status}). Check the API deployment.`, 0)
  }
  if (!response.ok) {
    const message = typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
      ? data.error : `Request failed (${response.status}).`
    throw new AdminRequestError(message, response.status)
  }
  return data as T
}
