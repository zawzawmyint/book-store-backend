import { afterEach, beforeEach, expect, it } from 'vitest'
import request from 'supertest'
import { createDatabase } from '../src/database/connection.js'
import { createApp } from '../src/app.js'
import { normalizeStore } from '../src/database/persistence.js'
import { loadEmailConfig } from '../src/modules/email/email-config.js'
import { createEmailCrypto } from '../src/modules/email/email-payload.crypto.js'

const emailConfig = loadEmailConfig({
  NODE_ENV: 'test',
  EMAIL_DELIVERY_MODE: 'queued',
  EMAIL_PAYLOAD_KEYS: JSON.stringify({ v1: Buffer.alloc(32, 7).toString('base64') }),
  EMAIL_PAYLOAD_ACTIVE_KEY_ID: 'v1',
})
const options = {
  frontendOrigin: 'http://localhost:5173',
  authBaseURL: 'http://localhost:5173',
  authSecret: 'email-api-test-secret-at-least-thirty-two-characters',
  emailConfig,
}
let db: ReturnType<typeof createDatabase>
let app: Awaited<ReturnType<typeof createApp>>
beforeEach(async () => {
  db = createDatabase(':memory:')
  app = await createApp(db, options)
})
afterEach(async () => {
  await app.locals.close()
  db.close()
})
const post = (path: string, body: object) =>
  request(app).post(`/api/auth/${path}`).set('Origin', options.frontendOrigin).send(body)

it('queues real verification and reset links without Redis or SMTP in the API', async () => {
  const credentials = { email: 'queued-api@example.com', password: 'correct-horse-battery-staple' }
  expect((await post('sign-up/email', { name: 'Queued reader', ...credentials })).status).toBe(200)
  const store = normalizeStore(db)
  const crypto = createEmailCrypto(emailConfig)
  let rows = await store.dueEmailNotifications(Date.now(), 50)
  expect(rows).toHaveLength(1)
  const verify = new URL(crypto.open(rows[0]).url!)
  expect((await request(app).get(verify.pathname + verify.search)).status).toBe(302)
  expect(
    (
      await post('request-password-reset', {
        email: credentials.email,
        redirectTo: 'http://localhost:5173/reset-password',
      })
    ).status,
  ).toBe(200)
  rows = await store.dueEmailNotifications(Date.now(), 50)
  const reset = rows.find((r) => r.kind === 'RESET_PASSWORD')!
  expect(reset).toBeDefined()
  const payload = crypto.open(reset)
  expect(await store.emailResetValid(payload.resetToken!, reset.userId!, Date.now())).toBe(true)
  expect(reset.expiresAt).toBe(await store.emailResetExpiry(payload.resetToken!))
})

it('marks queued API unready if durable email storage disappears', async () => {
  expect((await request(app).get('/ready')).status).toBe(200)
  db.exec('DROP TABLE email_notifications')
  expect((await request(app).get('/ready')).status).toBe(503)
})

it('rejects enabling order notifications with inline delivery', () => {
  expect(() =>
    loadEmailConfig({
      NODE_ENV: 'test',
      EMAIL_DELIVERY_MODE: 'inline',
      EMAIL_ORDER_NOTIFICATIONS_ENABLED: 'true',
    }),
  ).toThrow('queued')
})
