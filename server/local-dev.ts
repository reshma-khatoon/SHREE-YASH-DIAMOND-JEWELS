import 'dotenv/config'
import express from 'express'
import inquiries from '../api/inquiries.ts'
import orders from '../api/orders.ts'
import priceInquiries from '../api/price-inquiries.ts'
import visitors from '../api/visitors.ts'
import type { VercelRequest, VercelResponse } from './vercel-handler-types'

const app = express()
app.use(express.json({ limit: '20kb' }))

function invoke(handler: (request: VercelRequest, response: VercelResponse) => unknown) {
  return (request: express.Request, response: express.Response) => {
    void handler(request as unknown as VercelRequest, response as unknown as VercelResponse)
  }
}

app.all('/api/visitors', invoke(visitors))
app.all('/api/inquiries', invoke(inquiries))
app.all('/api/price-inquiries', invoke(priceInquiries))
app.all('/api/orders', invoke(orders))

const port = Number(process.env.API_PORT ?? 3001)
app.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Local API listening on http://127.0.0.1:${port}\n`)
})