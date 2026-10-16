import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createDatabase } from '../src/database/connection.js'
import { createApp } from '../src/app.js'
import type { AuthOptions } from '../src/auth.js'

const options = {
  frontendOrigin: 'http://localhost:5173',
  authBaseURL: 'http://localhost:4000',
  authSecret: 'test-secret-that-is-at-least-thirty-two-characters-long',
}
const credentials = { email: 'reader@example.com', password: 'correct-horse-battery-staple' }
type QueuedMail = Parameters<NonNullable<AuthOptions['enqueueAuthEmail']>>[0]
let db: ReturnType<typeof createDatabase>
let app: Awaited<ReturnType<typeof createApp>>
let queued: QueuedMail[]
let persist: (input: QueuedMail) => Promise<unknown>
const sender = { send: vi.fn() }
const post = (path: string, body: object) =>
  request(app).post(`/api/auth/${path}`).set('Origin', options.frontendOrigin).send(body)
const signup = () => post('sign-up/email', { name: 'Reader', ...credentials })
const rebuild = async () => {
  if (app) await app.locals.close()
  app = await createApp(db, {
    ...options,
    emailSender: sender,
    enqueueAuthEmail: (input) => persist(input),
  })
}
beforeEach(async () => {
  db = createDatabase(':memory:')
  queued = []
  sender.send.mockClear()
  persist = async (input) => {
    queued.push(input)
  }
  await rebuild()
})
afterEach(async () => {
  await app.locals.close()
  db.close()
  vi.restoreAllMocks()
})

it('awaits durable verification recording before signup returns without calling SMTP', async () => {
  let release!: () => void
  let started!: () => void
  const entered = new Promise<void>((resolve) => {
    started = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  persist = async (input) => {
    queued.push(input)
    started()
    await gate
  }
  let returned = false
  const response = signup().then((result) => {
    returned = true
    return result
  })
  await entered
  await new Promise((resolve) => setImmediate(resolve))
  expect(returned).toBe(false)
  release()
  expect((await response).status).toBe(200)
  expect(sender.send).not.toHaveBeenCalled()
  expect(queued).toHaveLength(1)
  const notification = queued[0]!
  expect(notification.kind).toBe('VERIFY_EMAIL')
  expect(notification.to).toBe(credentials.email)
  const url = new URL(notification.url)
  expect(url.searchParams.get('token')).toBe(notification.token)
  expect((await request(app).get(url.pathname + url.search)).status).toBe(302)
  expect((await post('sign-in/email', credentials)).status).toBe(200)
})

it('awaits reset persistence and preserves the framework single-use reset token and URL', async () => {
  await signup()
  let release!: () => void
  let started!: () => void
  const entered = new Promise<void>((resolve) => {
    started = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  persist = async (input) => {
    queued.push(input)
    started()
    await gate
  }
  let returned = false
  const response = post('request-password-reset', { email: credentials.email }).then((result) => {
    returned = true
    return result
  })
  await entered
  await new Promise((resolve) => setImmediate(resolve))
  expect(returned).toBe(false)
  release()
  expect((await response).status).toBe(200)
  const notification = queued.at(-1)!
  expect(notification.kind).toBe('RESET_PASSWORD')
  const url = new URL(notification.url)
  expect(url.pathname.split('/').at(-1)).toBe(notification.token)
  expect((await request(app).get(url.pathname + url.search)).headers.location).toContain(
    notification.token,
  )
  expect(
    (
      await post('reset-password', {
        token: notification.token,
        newPassword: 'replacement-password-123',
      })
    ).body,
  ).toEqual({ status: true })
  expect(
    (
      await post('reset-password', {
        token: notification.token,
        newPassword: 'replacement-password-456',
      })
    ).status,
  ).toBe(400)
  expect(sender.send).not.toHaveBeenCalled()
})

it('keeps failed auth recording redacted and known/unknown reset and resend responses neutral', async () => {
  const errors: string[] = []
  vi.spyOn(console, 'error').mockImplementation((line) => errors.push(String(line)))
  persist = async () => {
    throw new Error('recipient-secret token-secret database-secret')
  }
  expect((await signup()).status).toBe(200)
  expect(db.prepare('SELECT email_verified FROM user').get()).toEqual({ email_verified: 0 })
  const knownReset = await post('request-password-reset', { email: credentials.email })
  const unknownReset = await post('request-password-reset', { email: 'absent@example.com' })
  expect(knownReset.status).toBe(200)
  expect(knownReset.body).toEqual(unknownReset.body)
  const knownResend = await post('send-verification-email', { email: credentials.email })
  await rebuild()
  const unknownResend = await post('send-verification-email', { email: 'absent@example.com' })
  expect(knownResend.status).toBe(200)
  expect(knownResend.body).toEqual(unknownResend.body)
  expect(errors).toHaveLength(3)
  expect(errors.map((line) => JSON.parse(line))).toEqual(
    Array.from({ length: 3 }, () =>
      expect.objectContaining({
        event: 'email.auth_record_failed',
        errorCode: 'EMAIL_AUTH_RECORD_FAILED',
      }),
    ),
  )
  expect(errors.join('')).not.toMatch(/recipient-secret|token-secret|database-secret/)
  expect(sender.send).not.toHaveBeenCalled()
})

it('applies the same reset response floor to known and unknown accounts in queued mode', async () => {
  await signup()
  persist = async () => {
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  const measure = async (email: string) => {
    const start = performance.now()
    const response = await post('request-password-reset', { email })
    return { elapsed: performance.now() - start, response }
  }
  const known = await measure(credentials.email)
  const unknown = await measure('absent@example.com')
  expect(known.response.body).toEqual(unknown.response.body)
  expect(known.elapsed).toBeGreaterThanOrEqual(480)
  expect(unknown.elapsed).toBeGreaterThanOrEqual(480)
})
