import { afterEach, beforeEach, it, expect } from 'vitest'
import request from 'supertest'
import { createEmailVerificationToken } from 'better-auth/api'
import type Database from 'better-sqlite3'
import { createDatabase } from '../src/database/connection.js'
import { createApp } from '../src/app.js'
import type { EmailMessage } from '../src/modules/email/email.service.js'
const options = {
  frontendOrigin: 'http://localhost:5173',
  authBaseURL: 'http://localhost:4000',
  authSecret: 'test-secret-that-is-at-least-thirty-two-characters-long',
}
let db: Database.Database
let app: Awaited<ReturnType<typeof createApp>>
let mail: EmailMessage[]
const credentials = { email: 'reader@example.com', password: 'correct-horse-battery-staple' }
const post = (path: string, body: object) =>
  request(app).post(`/api/auth/${path}`).set('Origin', options.frontendOrigin).send(body)
const link = () => new URL(mail.at(-1)!.text.match(/https?:\/\/[^\s]+/)![0])
async function signup() {
  return post('sign-up/email', {
    name: 'Reader',
    ...credentials,
    callbackURL: `${options.frontendOrigin}/verification-result?returnTo=%2Fcheckout`,
  })
}
async function verifiedLogin() {
  await signup()
  await request(app).get(link().pathname + link().search)
  return post('sign-in/email', credentials)
}
beforeEach(async () => {
  db = createDatabase(':memory:')
  mail = []
  app = await createApp(db, {
    ...options,
    emailSender: {
      async send(message) {
        mail.push(message)
      },
    },
  })
})
afterEach(async () => {
  await app.locals.close()
  db.close()
})
it('requires verification and sends a captured link before sign-in', async () => {
  const response = await signup()
  expect(response.status).toBe(200)
  expect(response.body.token).toBeNull()
  expect(response.headers['set-cookie']).toBeUndefined()
  expect(mail).toHaveLength(1)
  expect((await post('sign-in/email', credentials)).status).toBe(403)
  const verify = await request(app).get(link().pathname + link().search)
  expect(verify.status).toBe(302)
  expect(verify.headers.location).toBe(
    `${options.frontendOrigin}/verification-result?returnTo=%2Fcheckout`,
  )
  expect(verify.headers['set-cookie']).toBeUndefined()
  expect((await post('sign-in/email', credentials)).status).toBe(200)
})
it('keeps repeated, invalid and expired verification links sessionless', async () => {
  await signup()
  const url = link()
  await request(app).get(url.pathname + url.search)
  expect((await request(app).get(url.pathname + url.search)).headers['set-cookie']).toBeUndefined()
  db.prepare('UPDATE user SET email_verified = 0').run()
  const expired = await createEmailVerificationToken(
    options.authSecret,
    credentials.email,
    undefined,
    -1,
  )
  for (const token of ['invalid', expired]) {
    const response = await request(app)
      .get('/api/auth/verify-email')
      .query({ token, callbackURL: 'https://evil.example/steal' })
    expect(response.headers.location).toMatch(
      /^http:\/\/localhost:5173\/verification-result\?error=/,
    )
    expect(response.headers['set-cookie']).toBeUndefined()
  }
  expect(db.prepare('SELECT email_verified FROM user').get()).toEqual({ email_verified: 0 })
})
it('returns neutral resend and reset responses and enforces the explicit IP limits', async () => {
  await signup()
  const resend = await post('send-verification-email', { email: credentials.email })
  expect(resend.body).toEqual({ status: true })
  expect((await post('send-verification-email', { email: 'absent@example.com' })).status).toBe(429)
  const statuses = []
  for (let i = 0; i < 4; i++)
    statuses.push((await post('request-password-reset', { email: 'absent@example.com' })).status)
  expect(statuses).toEqual([200, 200, 200, 429])
})
it('uses single-use reset tokens, changes the password and revokes every old session', async () => {
  const login = await verifiedLogin()
  const cookies = login.headers['set-cookie']
  const reset = await post('request-password-reset', {
    email: credentials.email,
    redirectTo: 'https://evil.example/steal',
  })
  expect(reset.status).toBe(200)
  const url = link()
  expect(url.searchParams.get('callbackURL')).toBe(`${options.frontendOrigin}/reset-password`)
  const redirect = await request(app).get(url.pathname + url.search)
  const token = new URL(redirect.headers.location).searchParams.get('token')
  expect(
    (await post('reset-password', { token, newPassword: 'replacement-password-123' })).body,
  ).toEqual({ status: true })
  expect(
    (await post('reset-password', { token, newPassword: 'another-password-123' })).status,
  ).toBe(400)
  expect(db.prepare('SELECT COUNT(*) AS count FROM session').get()).toEqual({ count: 0 })
  expect(
    (
      await request(app)
        .post('/graphql')
        .set('Origin', options.frontendOrigin)
        .set('Cookie', cookies)
        .send({ query: '{ viewer { id } }' })
    ).body.data.viewer,
  ).toBeNull()
  expect((await post('sign-in/email', credentials)).status).toBe(401)
  expect(
    (await post('sign-in/email', { ...credentials, password: 'replacement-password-123' })).status,
  ).toBe(200)
})
it('rejects expired reset tokens without replacing the password', async () => {
  await verifiedLogin()
  await post('request-password-reset', { email: credentials.email })
  const url = link()
  const token = url.pathname.split('/').at(-1)
  db.prepare('UPDATE verification SET expires_at = ?').run(Date.now() - 1000)
  expect(
    (await post('reset-password', { token, newPassword: 'replacement-password-123' })).status,
  ).toBe(400)
  expect((await post('sign-in/email', credentials)).status).toBe(200)
})
it('denies pre-feature unverified sessions on GraphQL without deleting accounts or roles', async () => {
  const login = await verifiedLogin()
  db.prepare('UPDATE user SET email_verified = 0').run()
  const response = await request(app)
    .post('/graphql')
    .set('Origin', options.frontendOrigin)
    .set('Cookie', login.headers['set-cookie'])
    .send({ query: '{ viewer { id } myOrders { total } }' })
  expect(response.body.errors[0].extensions.code).toBe('UNAUTHENTICATED')
  expect(db.prepare('SELECT COUNT(*) AS count FROM user').get()).toEqual({ count: 1 })
})
it('neutralizes callback destination attacks and preserves only safe return navigation', async () => {
  await post('sign-up/email', {
    name: 'Reader',
    ...credentials,
    callbackURL: `${options.frontendOrigin}/evil?returnTo=%2F%2Fevil.example`,
  })
  expect(link().searchParams.get('callbackURL')).toBe(
    `${options.frontendOrigin}/verification-result`,
  )
})
it('rejects old unverified sessions on authenticated account mutations without writes', async () => {
  const login = await verifiedLogin()
  db.prepare('UPDATE user SET email_verified = 0').run()
  const response = await request(app)
    .post('/api/auth/update-user')
    .set('Origin', options.frontendOrigin)
    .set('Cookie', login.headers['set-cookie'])
    .send({ name: 'Attacker rename' })
  expect(response.status).toBe(401)
  expect(db.prepare('SELECT name FROM user').get()).toEqual({ name: 'Reader' })
})
it('permanently revokes pre-feature sessions on verification and keeps replay from revoking fresh sign-in', async () => {
  const oldLogin = await verifiedLogin()
  db.prepare('UPDATE user SET email_verified = 0').run()
  await post('send-verification-email', { email: credentials.email })
  const url = link()
  await request(app).get(url.pathname + url.search)
  const oldViewer = await request(app)
    .post('/graphql')
    .set('Origin', options.frontendOrigin)
    .set('Cookie', oldLogin.headers['set-cookie'])
    .send({ query: '{ viewer { id } }' })
  expect(oldViewer.body.data.viewer).toBeNull()
  const fresh = await post('sign-in/email', credentials)
  await request(app).get(url.pathname + url.search)
  const freshViewer = await request(app)
    .post('/graphql')
    .set('Origin', options.frontendOrigin)
    .set('Cookie', fresh.headers['set-cookie'])
    .send({ query: '{ viewer { id } }' })
  expect(freshViewer.body.data.viewer.id).toBeTruthy()
})
it('discards auth route return navigation to prevent sign-in loops', async () => {
  await post('sign-up/email', {
    name: 'Reader',
    ...credentials,
    callbackURL: `${options.frontendOrigin}/verification-result?returnTo=%2Fsign-in`,
  })
  expect(link().searchParams.get('callbackURL')).toBe(
    `${options.frontendOrigin}/verification-result`,
  )
})
