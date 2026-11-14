import { createServer } from 'node:net'
import { createInterface } from 'node:readline'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app'

vi.mock('./supabase', () => ({ supabase: { from: vi.fn() } }))

async function withSmtpServer(rejectRecipient: boolean, run: (port: number, messages: string[]) => Promise<void>) {
  const messages: string[] = []
  const server = createServer((socket) => {
    let dataMode = false
    let message: string[] = []
    let awaitingAuth = false
    socket.write('220 localhost ESMTP\r\n')
    createInterface({ input: socket }).on('line', (line) => {
      if (dataMode) {
        if (line === '.') {
          messages.push(message.join('\n'))
          dataMode = false
          message = []
          socket.write('250 Message accepted\r\n')
        } else message.push(line)
      } else if (awaitingAuth) {
        awaitingAuth = false
        socket.write('235 Authentication successful\r\n')
      } else if (/^(EHLO|HELO) /i.test(line)) {
        socket.write('250-localhost\r\n250 AUTH PLAIN\r\n')
      } else if (/^AUTH PLAIN /i.test(line)) {
        socket.write('235 Authentication successful\r\n')
      } else if (/^AUTH PLAIN$/i.test(line)) {
        awaitingAuth = true
        socket.write('334 \r\n')
      } else if (/^MAIL FROM:/i.test(line)) {
        socket.write('250 Sender accepted\r\n')
      } else if (/^RCPT TO:/i.test(line)) {
        socket.write(rejectRecipient ? '550 Recipient rejected\r\n' : '250 Recipient accepted\r\n')
      } else if (line === 'DATA') {
        dataMode = true
        socket.write('354 End data with <CRLF>.<CRLF>\r\n')
      } else if (line === 'QUIT') {
        socket.end('221 Goodbye\r\n')
      } else {
        socket.write('250 OK\r\n')
      }
    })
  })
  server.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('SMTP test server did not start')
  try {
    await run(address.port, messages)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

describe('real Nodemailer SMTP transport', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it.each([false, true])('sends contact and cart requests and reports recipient rejection=%s', async (rejectRecipient) => {
    await withSmtpServer(rejectRecipient, async (port, messages) => {
      vi.stubEnv('SMTP_HOST', '127.0.0.1')
      vi.stubEnv('SMTP_PORT', String(port))
      vi.stubEnv('SMTP_USER', 'sender@example.test')
      vi.stubEnv('SMTP_PASS', 'test-password')
      vi.stubEnv('OWNER_EMAIL', 'owner@example.test')
      vi.stubEnv('MAIL_FROM', '')
      vi.stubEnv('WHATSAPP_ACCESS_TOKEN', '')
      vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const save = vi.fn().mockResolvedValue(undefined)
      const server = createApp(undefined, save).listen(0, '127.0.0.1')
      await new Promise<void>((resolve) => server.once('listening', resolve))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('API test server did not start')
      const base = `http://127.0.0.1:${address.port}`
      try {
        for (const [path, body] of [
          ['/api/contact', { name: 'Test Customer', phone: '+919876543210', email: 'customer@example.test', message: 'Please call me.' }],
          ['/api/cart-leads', {
            customer: { name: 'Test Customer', phone: '+919876543210', email: 'customer@example.test' },
            items: [{ productId: 'celeste-diamond-ring', goldPurity: '18K', quantity: 2 }],
          }],
        ] as const) {
          const response = await fetch(`${base}${path}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          })
          expect(response.status).toBe(201)
          expect((await response.json()).notificationStatus).toBe(rejectRecipient ? 'failed' : 'sent')
        }
        expect(save).toHaveBeenCalledTimes(2)
        if (rejectRecipient) expect(messages).toHaveLength(0)
        else {
          expect(messages).toHaveLength(2)
          expect(messages[0]).toContain('Please call me.')
          expect(messages[1]).toContain('Celeste Diamond Ring')
          for (const message of messages) {
            expect(message).toContain('Test Customer')
            expect(message).toContain('+919876543210')
            expect(message).toContain('customer@example.test')
          }
        }
      } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      }
    })
  })
})
