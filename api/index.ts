const maxBodyBytes = 20 * 1024

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.has('x-shree-yash-api-proxy')) {
      console.error('API backend points back to the Vercel proxy')
      return jsonError(503, 'The API backend is not configured correctly.')
    }

    const configuredOrigin = process.env.API_BACKEND_ORIGIN || process.env.VITE_API_BASE_URL
    if (!configuredOrigin) {
      return jsonError(503, 'The API backend is not configured. Contact the website administrator.')
    }

    let backend: URL
    try {
      backend = new URL(configuredOrigin)
    } catch {
      console.error('API_BACKEND_ORIGIN is not a valid URL')
      return jsonError(503, 'The API backend is not configured correctly.')
    }

    const incoming = new URL(request.url)
    if (backend.protocol !== 'https:' || backend.username || backend.password
      || backend.pathname !== '/' || backend.search || backend.hash || backend.origin === incoming.origin) {
      console.error('API backend must be a separate HTTPS origin without a path')
      return jsonError(503, 'The API backend is not configured correctly.')
    }

    const path = incoming.searchParams.get('__api_path')
      ?? (incoming.pathname.startsWith('/api/') && incoming.pathname !== '/api/index' ? incoming.pathname.slice(5) : null)
    if (!path || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(path)) {
      return jsonError(400, 'Invalid API path.')
    }
    incoming.searchParams.delete('__api_path')
    backend.pathname = `/api/${path}`
    backend.search = incoming.searchParams.toString()

    const headers = new Headers()
    for (const name of ['accept', 'authorization', 'content-type', 'origin']) {
      const value = request.headers.get(name)
      if (value) headers.set(name, value)
    }
    headers.set('x-shree-yash-api-proxy', '1')

    const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer()
    if (body && body.byteLength > maxBodyBytes) return jsonError(413, 'Request body is too large.')

    try {
      const response = await fetch(backend, { method: request.method, headers, body, redirect: 'manual' })
      if (response.status >= 300 && response.status < 400) {
        console.error('API backend returned an unexpected redirect')
        return jsonError(502, 'The API backend returned an unexpected response.')
      }
      const contentType = response.headers.get('content-type') || ''
      if (response.status !== 204 && !contentType.toLowerCase().includes('application/json')) {
        console.error(`API backend returned a non-JSON response (${response.status})`)
        return jsonError(502, 'The API backend returned an unexpected response.')
      }
      const responseHeaders = new Headers({ 'Cache-Control': 'no-store' })
      if (contentType) responseHeaders.set('Content-Type', contentType)
      for (const name of ['access-control-allow-origin', 'access-control-allow-headers', 'access-control-allow-methods', 'vary']) {
        const value = response.headers.get(name)
        if (value) responseHeaders.set(name, value)
      }
      return new Response(response.body, { status: response.status, headers: responseHeaders })
    } catch (error) {
      console.error('API backend request failed:', error)
      return jsonError(502, 'The API backend is unavailable. Please try again later.')
    }
  },
}
