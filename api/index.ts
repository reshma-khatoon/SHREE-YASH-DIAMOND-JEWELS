
import type { Request, Response } from 'express'
import app from '../server/app.js'


export default function handler(req: Request, res: Response) {
  const requestUrl = new URL(
    req.url || '/',
    `https://${req.headers.host || 'localhost'}`
  )

  const apiPath = requestUrl.searchParams.get('__api_path')

  if (
    !apiPath ||
    !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(apiPath)
  ) {
    res.status(400).json({ error: 'Invalid API path.' })
    return
  }

  requestUrl.searchParams.delete('__api_path')
  req.url = `/api/${apiPath}${requestUrl.search}`

  return app(req, res)
}
