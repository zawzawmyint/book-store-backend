import { deliveryOptions, reviewedInput } from './delivery-fixtures.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { request as httpRequest } from 'node:http'
import { once } from 'node:events'
import type Database from 'better-sqlite3'
import { createApp } from '../src/app.js'
import { createDatabase } from '../src/database/connection.js'
import { seedBooks } from '../src/database/seed.js'
import { randomUUID } from 'node:crypto'
import { FakePaymentProvider } from './fake-payment-provider.js'
const authOptions = {
  frontendOrigin: 'http://localhost:5173',
  authBaseURL: 'http://localhost:4000',
  authSecret: 'test-secret-that-is-at-least-thirty-two-characters-long',
}
const orderMutation =
  'mutation ($input: CreateCheckoutInput!) { createCheckout(input: $input) { order { id totalCents } } }'
const historyQuery =
  'query { myOrders { total items { id totalCents createdAt items { title quantity unitPriceCents } } } }'
describe('customer authentication and order ownership', () => {
  let db: Database.Database
  let app: Awaited<ReturnType<typeof createApp>>
  beforeEach(async () => {
    db = createDatabase(':memory:')
    seedBooks(db)
    app = await createApp(db, authOptions, {
      ...deliveryOptions,
      provider: new FakePaymentProvider(),
    })
  })
  afterEach(() => db.close())
  async function signUp(name: string, email: string) {
    const response = await request(app)
      .post('/api/auth/sign-up/email')
      .set('Origin', authOptions.frontendOrigin)
      .send({
        name,
        email,
        password: 'correct-horse-battery-staple',
      })
    expect(response.status).toBe(200)
    expect(response.headers['set-cookie']).toBeDefined()
    return response.headers['set-cookie'] as string[]
  }
  it('rejects unauthenticated order writes without touching stock', async () => {
    const result = await request(app)
      .post('/graphql')
      .set('Origin', authOptions.frontendOrigin)
      .send({
        query: orderMutation,
        variables: {
          input: {
            ...reviewedInput(db, {
              requestKey: randomUUID(),
              items: [
                {
                  bookId: '1',
                  quantity: 1,
                },
              ],
            }),
          },
        },
      })
    expect(result.body.errors[0].extensions.code).toBe('UNAUTHENTICATED')
    expect(db.prepare('SELECT COUNT(*) AS count FROM orders').get()).toEqual({
      count: 0,
    })
    expect(db.prepare('SELECT stock FROM books WHERE id = 1').get()).toEqual({
      stock: 12,
    })
  })
  it('stores a signed-in order under its session user and lists only that user orders', async () => {
    const adaCookies = await signUp('Ada Reader', 'ada@example.com')
    const bobCookies = await signUp('Bob Reader', 'bob@example.com')
    const placed = await request(app)
      .post('/graphql')
      .set('Origin', authOptions.frontendOrigin)
      .set('Cookie', adaCookies)
      .send({
        query: orderMutation,
        variables: {
          input: {
            ...reviewedInput(db, {
              requestKey: randomUUID(),
              items: [
                {
                  bookId: '1',
                  quantity: 2,
                },
              ],
            }),
          },
        },
      })
    expect(placed.body.errors).toBeUndefined()
    const stored = db.prepare('SELECT user_id, customer_name, email FROM orders').get() as {
      user_id: string
      customer_name: string
      email: string
    }
    expect(stored.user_id).toBeTruthy()
    expect(stored.customer_name).toBe('Ada Reader')
    expect(stored.email).toBe('ada@example.com')
    const ownHistory = await request(app)
      .post('/graphql')
      .set('Origin', authOptions.frontendOrigin)
      .set('Cookie', adaCookies)
      .send({
        query: historyQuery,
      })
    expect(ownHistory.body.errors).toBeUndefined()
    expect(ownHistory.body.data.myOrders.total).toBe(1)
    expect(ownHistory.body.data.myOrders.items[0].id).toBe(placed.body.data.createCheckout.order.id)
    const otherHistory = await request(app)
      .post('/graphql')
      .set('Origin', authOptions.frontendOrigin)
      .set('Cookie', bobCookies)
      .send({
        query: historyQuery,
      })
    expect(otherHistory.body.data.myOrders).toEqual({
      total: 0,
      items: [],
    })
    const anonymousHistory = await request(app).post('/graphql').send({
      query: historyQuery,
    })
    expect(anonymousHistory.body.errors[0].extensions.code).toBe('UNAUTHENTICATED')
  })
  it('restores a session after sign-in and invalidates it on sign-out', async () => {
    await signUp('Ada Reader', 'ada@example.com')
    const signIn = await request(app)
      .post('/api/auth/sign-in/email')
      .set('Origin', authOptions.frontendOrigin)
      .send({
        email: 'ada@example.com',
        password: 'correct-horse-battery-staple',
      })
    expect(signIn.status).toBe(200)
    const cookies = signIn.headers['set-cookie'] as string[]
    const session = await request(app).get('/api/auth/get-session').set('Cookie', cookies)
    expect(session.body.user.email).toBe('ada@example.com')
    expect(session.body.user.emailVerified).toBe(false)
    const signOut = await request(app)
      .post('/api/auth/sign-out')
      .set('Origin', authOptions.frontendOrigin)
      .set('Cookie', cookies)
      .send({})
    expect(signOut.status).toBe(200)
    const afterSignOut = await request(app)
      .post('/graphql')
      .set('Origin', authOptions.frontendOrigin)
      .set('Cookie', cookies)
      .send({
        query: historyQuery,
      })
    expect(afterSignOut.body.errors[0].extensions.code).toBe('UNAUTHENTICATED')
  })
  it('rejects an authenticated GraphQL request from another origin', async () => {
    const cookies = await signUp('Ada Reader', 'ada@example.com')
    const response = await request(app)
      .post('/graphql')
      .set('Origin', 'https://untrusted.example')
      .set('Cookie', cookies)
      .send({
        query: historyQuery,
      })
    expect(response.status).toBe(403)
  })
  it('does not let forged forwarded IP headers evade sign-in rate limits', async () => {
    await signUp('Ada Reader', 'ada@example.com')
    const statuses: number[] = []
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await request(app)
        .post('/api/auth/sign-in/email')
        .set('Origin', authOptions.frontendOrigin)
        .set('X-Forwarded-For', `198.51.100.${attempt + 1}`)
        .send({
          email: 'ada@example.com',
          password: 'incorrect-password',
        })
      statuses.push(response.status)
    }
    expect(statuses.at(-1)).toBe(429)
  })
  it('validates and trims names on sign-up and account updates', async () => {
    const cookies = await signUp('  Ada Reader  ', 'ada@example.com')
    expect(db.prepare('SELECT name FROM user').get()).toEqual({
      name: 'Ada Reader',
    })
    for (const name of ['   ', 'x'.repeat(121)]) {
      const response = await request(app)
        .post('/api/auth/sign-up/email')
        .set('Origin', authOptions.frontendOrigin)
        .send({
          name,
          email: `invalid-${name.length}@example.com`,
          password: 'correct-horse-battery-staple',
        })
      expect(response.status).toBe(400)
    }
    for (const name of ['   ', 'x'.repeat(121)]) {
      const response = await request(app)
        .post('/api/auth/update-user')
        .set('Origin', authOptions.frontendOrigin)
        .set('Cookie', cookies)
        .send({
          name,
        })
      expect(response.status).toBe(400)
    }
  })
  it('rejects an empty sign-up name', async () => {
    const response = await request(app)
      .post('/api/auth/sign-up/email')
      .set('Origin', authOptions.frontendOrigin)
      .send({
        name: '',
        email: 'empty@example.com',
        password: 'correct-horse-battery-staple',
      })
    expect(response.status).toBe(400)
  })
  it('rejects oversized auth bodies with or without Content-Length', async () => {
    const body = JSON.stringify({
      name: 'x'.repeat(70_000),
      email: 'ada@example.com',
      password: 'secret',
    })
    const sized = await request(app)
      .post('/api/auth/sign-up/email')
      .set('Origin', authOptions.frontendOrigin)
      .set('Content-Type', 'application/json')
      .send(body)
    expect(sized.status).toBe(413)
    const listener = app.listen(0)
    try {
      const address = listener.address()
      if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
      const status = await new Promise<number>((resolve, reject) => {
        const outgoing = httpRequest(
          {
            port: address.port,
            method: 'POST',
            path: '/api/auth/sign-up/email',
            headers: {
              origin: authOptions.frontendOrigin,
              'content-type': 'application/json',
              'transfer-encoding': 'chunked',
            },
          },
          (incoming) => {
            incoming.resume()
            incoming.on('end', () => resolve(incoming.statusCode ?? 0))
          },
        )
        outgoing.on('error', reject)
        outgoing.write(body.slice(0, 35_000))
        outgoing.end(body.slice(35_000))
      })
      expect(status).toBe(413)
    } finally {
      listener.close()
      await once(listener, 'close')
    }
  })
})
