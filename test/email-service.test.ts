import { authEmail } from '../src/modules/email/email.content.js'
import { expect, it, vi, afterEach } from 'vitest'
import nodemailer from 'nodemailer'
import { createEmailSender, createMailDispatcher } from '../src/modules/email/email.service.js'
afterEach(() => vi.restoreAllMocks())
it('logs email outcomes without recipient, reset links or exception messages', async () => {
  const lines: string[] = []
  vi.spyOn(console, 'log').mockImplementation((line) => lines.push(String(line)))
  vi.spyOn(console, 'error').mockImplementation((line) => lines.push(String(line)))
  let failing = false
  const mail = createMailDispatcher({
    async send() {
      if (failing) throw new Error('SMTP password-secret token-secret')
    },
  })
  const message = authEmail(
    'private-email-secret@example.com',
    'https://books.example/token-secret',
    'reset',
  )
  mail.send(message)
  await mail.close()
  failing = true
  mail.send(message)
  await mail.close()
  expect(lines.map((line) => JSON.parse(line))).toEqual([
    expect.objectContaining({ event: 'email.delivered', level: 'info' }),
    expect.objectContaining({ event: 'email.delivery_failed', level: 'error' }),
  ])
  for (const secret of ['private-email-secret', 'token-secret', 'password-secret'])
    expect(lines.join('')).not.toContain(secret)
})
it('escapes link HTML and keeps separate recovery and verification content', () => {
  const message = authEmail('reader@example.com', 'https://books.example/?token="<&', 'verify')
  expect(message.html).toContain('&quot;&lt;&amp;')
  expect(message.text).toContain('https://books.example/?token="<&')
  expect(authEmail(message.to, 'https://books.example/reset', 'reset').subject).toContain(
    'Reset your password',
  )
})
it('observes failures without exposing transport details and drains pending sends', async () => {
  const failures: string[] = []
  const mail = createMailDispatcher(
    {
      async send() {
        throw new Error('secret password token message')
      },
    },
    () => failures.push('Delivery failed'),
  )
  mail.send(authEmail('reader@example.com', 'https://books.example/token', 'verify'))
  await mail.close()
  expect(failures).toEqual(['Delivery failed'])
})
it('bounds shutdown even when a sender never resolves', async () => {
  let closed = false
  const mail = createMailDispatcher({
    send: () => new Promise(() => {}),
    close() {
      closed = true
    },
  })
  mail.send(authEmail('reader@example.com', 'https://books.example/token', 'verify'))
  const start = Date.now()
  await mail.close(10)
  expect(Date.now() - start).toBeLessThan(500)
  expect(closed).toBe(true)
})
it('uses one transporter with verified TLS and bounded waits without enabling body logs', async () => {
  const sent: unknown[] = []
  const create = vi.spyOn(nodemailer, 'createTransport').mockReturnValue({
    async sendMail(message: unknown) {
      sent.push(message)
    },
    close() {},
  } as any)
  const sender = createEmailSender({
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    from: 'The Quiet Shelf <sender@example.com>',
    username: 'fixture',
    password: 'fixture',
  })
  await sender.send(authEmail('reader@example.com', 'https://books.example/token', 'verify'))
  await sender.send(authEmail('reader@example.com', 'https://books.example/reset', 'reset'))
  expect(create).toHaveBeenCalledOnce()
  expect(create.mock.calls[0][0]).toMatchObject({
    secure: false,
    requireTLS: true,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  })
  expect(create.mock.calls[0][0]).not.toHaveProperty('tls')
  expect(create.mock.calls[0][0]).not.toHaveProperty('logger')
  expect(sent).toHaveLength(2)
})
