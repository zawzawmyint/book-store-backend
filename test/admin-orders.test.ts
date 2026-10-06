import { afterEach, beforeEach, expect, it } from 'vitest'
import request from 'supertest'
import type Database from 'better-sqlite3'
import { createApp } from '../src/app.js'
import { createDatabase } from '../src/database/connection.js'
import { seedBooks } from '../src/database/seed.js'

const options = {
  frontendOrigin: 'http://localhost:5173',
  authBaseURL: 'http://localhost:5173',
  authSecret: 'admin-test-secret-at-least-thirty-two-characters',
}
let db: Database.Database
let app: Awaited<ReturnType<typeof createApp>>
let cookies: string[]
let customer: string[]
beforeEach(async () => {
  db = createDatabase(':memory:')
  seedBooks(db)
  app = await createApp(db, options)
  for (const email of ['admin@example.com', 'customer@example.com']) {
    const res = await request(app)
      .post('/api/auth/sign-up/email')
      .set('Origin', options.frontendOrigin)
      .send({ name: 'Reader', email, password: 'correct-horse-battery-staple' })
    expect(res.status).toBe(200)
    if (email.startsWith('admin')) {
      cookies = res.headers['set-cookie'] as string[]
      db.prepare('INSERT INTO user_roles (user_id, role) VALUES (?, \'ADMIN\')').run(res.body.user.id)
    } else customer = res.headers['set-cookie'] as string[]
  }
})
afterEach(() => db.close())
function gql(query: string, auth = cookies) {
  const req = request(app).post('/graphql').set('Origin', options.frontendOrigin)
  if (auth.length) req.set('Cookie', auth)
  return req.send({ query })
}
it('lists every request and legacy contact snapshot in stable newest-first order, without changing customer history', async () => {
  const placed = await gql(
    'mutation { placeOrder(input: { items: [{ bookId: "1", quantity: 1 }] }) { id } }',
    customer,
  )
  expect(placed.body.errors).toBeUndefined()
  db.prepare("UPDATE orders SET created_at = '2026-10-01 10:00:00'").run()
  db.prepare(
    "INSERT INTO orders (customer_name, email, total_cents, created_at) VALUES ('Legacy', 'legacy@example.com', 55, '2026-10-01 10:00:00')",
  ).run()
  const result = await gql(
    '{ adminOrders(limit: 1) { total items { id userId customerName email totalCents } } }',
  )
  expect(result.body.errors).toBeUndefined()
  expect(result.body.data.adminOrders).toEqual({
    total: 2,
    items: [
      {
        id: '2',
        userId: null,
        customerName: 'Legacy',
        email: 'legacy@example.com',
        totalCents: 55,
      },
    ],
  })
  db.prepare("UPDATE books SET title = 'Changed', price_cents = 1 WHERE id = 1").run()
  const detail = await gql(
    '{ adminOrder(id: "1") { email items { title quantity unitPriceCents } } }',
  )
  expect(detail.body.data.adminOrder.email).toBe('customer@example.com')
  expect(detail.body.data.adminOrder.items[0].title).not.toBe('Changed')
  expect(detail.body.data.adminOrder.items[0].unitPriceCents).not.toBe(1)
  expect((await gql('{ myOrders { total } }', customer)).body.data.myOrders.total).toBe(1)
})
it('protects private order queries and validates pagination and lookup', async () => {
  for (const query of [
    '{ adminOrders { total } }',
    '{ secret: adminOrder(id: "999") { email } }',
  ]) {
    expect((await gql(query, customer)).body.errors[0].extensions.code).toBe('FORBIDDEN')
    expect((await gql(query, [])).body.errors[0].extensions.code).toBe('UNAUTHENTICATED')
  }
  expect((await gql('{ adminOrders(limit: 51) { total } }')).body.errors[0].extensions.code).toBe(
    'BAD_USER_INPUT',
  )
  expect((await gql('{ adminOrder(id: "bad") { id } }')).body.errors[0].extensions.code).toBe(
    'BAD_USER_INPUT',
  )
  expect((await gql('{ adminOrder(id: "999") { id } }')).body.data.adminOrder).toBeNull()
})
