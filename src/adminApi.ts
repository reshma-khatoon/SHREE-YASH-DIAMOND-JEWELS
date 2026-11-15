const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? ''

export type AdminCounts = {
  inquiries: { total: number; new: number }
  orders: { total: number; new: number }
  cartLeads: { total: number; new: number }
}

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

export async function getAdminCounts(token: string): Promise<AdminCounts> {
  const result = await adminRequest<unknown>('/counts', token)
  const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
  const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  if (!isObject(result) || !isObject(result.inquiries) || !isObject(result.orders) || !isObject(result.cartLeads)
    || !isCount(result.inquiries.total) || !isCount(result.inquiries.new)
    || !isCount(result.orders.total) || !isCount(result.orders.new)
    || !isCount(result.cartLeads.total) || !isCount(result.cartLeads.new)
    || !Number.isSafeInteger(result.inquiries.new + result.orders.new + result.cartLeads.new)) {
    throw new AdminRequestError('The admin API returned invalid dashboard counts.', 0)
  }
  return {
    inquiries: { total: result.inquiries.total, new: result.inquiries.new },
    orders: { total: result.orders.total, new: result.orders.new },
    cartLeads: { total: result.cartLeads.total, new: result.cartLeads.new },
  }
}
