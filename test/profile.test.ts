import { afterEach, beforeEach, expect, it } from 'vitest'
import request from 'supertest'
import type Database from 'better-sqlite3'
import { createApp } from '../src/app.js'
import { createDatabase } from '../src/database/connection.js'
import { seedBooks } from '../src/database/seed.js'
import { randomUUID } from 'node:crypto'
import { FakePaymentProvider } from './fake-payment-provider.js'

const options = {
  frontendOrigin: 'http://localhost:5173',
  authBaseURL: 'http://localhost:4000',
  authSecret: 'test-secret-that-is-at-least-thirty-two-characters-long',
}
const password = 'correct-horse-battery-staple'
let db: Database.Database
let app: Awaited<ReturnType<typeof createApp>>

beforeEach(async () => {
  db = createDatabase(':memory:')
  seedBooks(db)
  app = await createApp(db, options, { provider: new FakePaymentProvider() })
})
afterEach(() => db.close())

async function signUp(name: string, email: string) {
  const response = await request(app)
    .post('/api/auth/sign-up/email')
    .set('Origin', options.frontendOrigin)
    .send({ name, email, password })
  expect(response.status).toBe(200)
  return response.headers['set-cookie'] as string[]
}

function authPost(path: string, cookies: string[] | undefined, body: Record<string, unknown>) {
  const req = request(app).post(path).set('Origin', options.frontendOrigin)
  if (cookies?.length) req.set('Cookie', cookies)
  return req.send(body)
}

it('renames the signed-in account, keeps past order snapshots, and rejects other account fields', async () => {
  const ada = await signUp('Ada Reader', 'ada@example.com')
  const bob = await signUp('Bob Reader', 'bob@example.com')
  const placed = await request(app)
    .post('/graphql')
    .set('Origin', options.frontendOrigin)
    .set('Cookie', ada)
    .send({
      query: `mutation { createCheckout(input: { requestKey: "${randomUUID()}", items: [{ bookId: "1", quantity: 1 }] }) { order { id } } }`,
    })
  expect(placed.body.errors).toBeUndefined()
  const renamed = await authPost('/api/auth/update-user', ada, { name: '  Ada Updated  ' })
  expect(renamed.status).toBe(200)
  expect(db.prepare('SELECT name, email, image FROM user WHERE email = ?').get('ada@example.com')).toEqual({
    name: 'Ada Updated',
    email: 'ada@example.com',
    image: null,
  })
  expect(db.prepare('SELECT customer_name, email FROM orders').get()).toEqual({
    customer_name: 'Ada Reader',
    email: 'ada@example.com',
  })
  const nextCookies = (renamed.headers['set-cookie'] as string[] | undefined) ?? ada
  const later = await request(app)
    .post('/graphql')
    .set('Origin', options.frontendOrigin)
    .set('Cookie', nextCookies)
    .send({
      query: `mutation { createCheckout(input: { requestKey: "${randomUUID()}", items: [{ bookId: "1", quantity: 1 }] }) { order { id } } }`,
    })
  expect(later.body.errors).toBeUndefined()
  const names = db
    .prepare('SELECT customer_name FROM orders ORDER BY id')
    .all() as { customer_name: string }[]
  expect(names.map((row) => row.customer_name)).toEqual(['Ada Reader', 'Ada Updated'])
  expect((await authPost('/api/auth/update-user', ada, { email: 'other@example.com' })).status).toBe(400)
  expect((await authPost('/api/auth/update-user', ada, { image: 'https://example.com/a.png' })).status).toBe(400)
  expect((await authPost('/api/auth/update-user', ada, { name: 'Stolen', id: 'bob' })).status).toBe(200)
  expect(db.prepare('SELECT name, email FROM user WHERE email = ?').get('bob@example.com')).toEqual({
    name: 'Bob Reader',
    email: 'bob@example.com',
  })
  const bobSession = await request(app).get('/api/auth/get-session').set('Cookie', bob)
  expect(bobSession.body.user.name).toBe('Bob Reader')
  expect(db.prepare('SELECT email FROM user WHERE email = ?').get('ada@example.com')).toEqual({
    email: 'ada@example.com',
  })
  expect((await authPost('/api/auth/update-user', undefined, { name: 'Guest' })).status).toBe(401)
})

it('rejects a guest and a wrong current password without changing the stored password', async () => {
  expect((await authPost('/api/auth/change-password', undefined, {
    currentPassword: password,
    newPassword: 'new-password-123',
    revokeOtherSessions: true,
  })).status).toBe(401)
  const cookies = await signUp('Ada Reader', 'ada@example.com')
  const before = db.prepare('SELECT password FROM account').get()
  expect((await authPost('/api/auth/change-password', cookies, {
    currentPassword: 'wrong-password',
    newPassword: 'new-password-123',
    revokeOtherSessions: true,
  })).status).toBe(400)
  expect(db.prepare('SELECT password FROM account').get()).toEqual(before)
})

it('rejects a new password shorter than 8 characters', async () => {
  const cookies = await signUp('Ada Reader', 'ada@example.com')
  const before = db.prepare('SELECT password FROM account').get()
  expect((await authPost('/api/auth/change-password', cookies, {
    currentPassword: password,
    newPassword: 'short',
    revokeOtherSessions: true,
  })).status).toBe(400)
  expect(db.prepare('SELECT password FROM account').get()).toEqual(before)
})

it('changes a password when the current password matches and keeps only the current session', async () => {
  const cookies = await signUp('Ada Reader', 'ada@example.com')
  const before = db.prepare('SELECT password FROM account').get()
  const changed = await authPost('/api/auth/change-password', cookies, {
    currentPassword: password,
    newPassword: 'new-password-123',
    revokeOtherSessions: true,
  })
  expect(changed.status).toBe(200)
  expect(db.prepare('SELECT password FROM account').get()).not.toEqual(before)
  const nextCookies = changed.headers['set-cookie'] as string[]
  const session = await request(app).get('/api/auth/get-session').set('Cookie', nextCookies)
  expect(session.body.user.email).toBe('ada@example.com')
  const stale = await request(app).get('/api/auth/get-session').set('Cookie', cookies)
  expect(stale.body).toBeNull()
  expect((await authPost('/api/auth/sign-in/email', undefined, {
    email: 'ada@example.com',
    password,
  })).status).toBe(401)
  expect((await authPost('/api/auth/sign-in/email', undefined, {
    email: 'ada@example.com',
    password: 'new-password-123',
  })).status).toBe(200)
})
