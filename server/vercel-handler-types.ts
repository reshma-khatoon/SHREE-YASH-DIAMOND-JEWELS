import type { IncomingMessage, ServerResponse } from 'node:http'

export interface VercelRequest extends IncomingMessage {
  body?: unknown
  ip?: string
}

export interface VercelResponse extends ServerResponse {
  status(code: number): this
  json(body: unknown): this
}