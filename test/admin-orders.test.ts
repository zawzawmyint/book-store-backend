import { seedSubmittedOrder } from './order-fixtures.js'
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
      db.prepare("INSERT INTO user_roles (user_id, role) VALUES (?, 'ADMIN')").run(res.body.user.id)
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
  seedSubmittedOrder(db, {
    name: 'Legacy',
    email: 'legacy@example.com',
    totalCents: 55,
    createdAt: '2026-10-01 10:00:00',
  })
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

it('exposes owner-safe details, attributed workspace history and guarded workflow actions', async () => {
  const placed = await gql(
    'mutation { placeOrder(input:{items:[{bookId:"1",quantity:1}]}) { id status } }',
    customer,
  )
  expect(placed.body.data.placeOrder.status).toBe('SUBMITTED')
  const id = placed.body.data.placeOrder.id
  expect(
    (
      await gql(
        `{ myOrder(id:"${id}") { id status history { toStatus cancellationReason } } }`,
        customer,
      )
    ).body.data.myOrder.history,
  ).toHaveLength(1)
  expect((await gql(`{ myOrder(id:"${id}") { id } }`)).body.data.myOrder).toBeNull()
  expect((await gql('{ myOrder(id:"bad") { id } }', customer)).body.errors[0].extensions.code).toBe(
    'BAD_USER_INPUT',
  )
  const mutation = `mutation { setOrderStatus(input:{id:"${id}",expectedStatus:SUBMITTED,status:ACCEPTED}) { status history { actorName actorRole toStatus } } }`
  expect((await gql(mutation, customer)).body.errors[0].extensions.code).toBe('FORBIDDEN')
  expect((await gql(mutation, [])).body.errors[0].extensions.code).toBe('UNAUTHENTICATED')
  const accepted = await gql(mutation)
  expect(accepted.body.errors).toBeUndefined()
  expect(accepted.body.data.setOrderStatus.history[1]).toMatchObject({
    actorName: 'Reader',
    actorRole: 'ADMIN',
    toStatus: 'ACCEPTED',
  })
  expect(
    (
      await gql(
        `mutation { setOrderStatus(input:{id:"${id}",expectedStatus:SUBMITTED,status:CANCELLED,cancellationReason:"No"}) { id } }`,
      )
    ).body.errors[0].extensions.code,
  ).toBe('CONFLICT')
  expect(
    (
      await gql(
        `mutation { setOrderStatus(input:{id:"${id}",expectedStatus:ACCEPTED,status:CANCELLED}) { id } }`,
      )
    ).body.errors[0].extensions.code,
  ).toBe('BAD_USER_INPUT')
  expect(
    (await gql('{ adminOrders(status:ACCEPTED) { total items { status } } }')).body.data.adminOrders
      .total,
  ).toBe(1)
  expect(
    (await gql(`{ myOrder(id:"${id}") { history { actorName } } }`, customer)).body.errors[0]
      .message,
  ).toContain('Cannot query field')
})

it('serializes simultaneous cancellations and conflicting status requests', async () => {
  const placed = await gql(
    'mutation { placeOrder(input:{items:[{bookId:"1",quantity:2}]}) { id } }',
    customer,
  )
  const id = placed.body.data.placeOrder.id
  const stock = db.prepare('SELECT stock FROM books WHERE id=1').get() as { stock: number }
  const cancel = `mutation { setOrderStatus(input:{id:"${id}",expectedStatus:SUBMITTED,status:CANCELLED,cancellationReason:" Reason "}) { status history { cancellationReason } } }`
  const results = await Promise.all([gql(cancel), gql(cancel)])
  expect(results.every((result) => !result.body.errors)).toBe(true)
  expect(results[0].body.data.setOrderStatus.history[1].cancellationReason).toBe('Reason')
  expect(db.prepare('SELECT stock FROM books WHERE id=1').get()).toEqual({ stock: stock.stock + 2 })
  expect(
    db.prepare('SELECT count(*) AS n FROM order_status_events WHERE order_id=?').get(id),
  ).toEqual({ n: 2 })
  const second = await gql(
    'mutation { placeOrder(input:{items:[{bookId:"1",quantity:1}]}) { id } }',
    customer,
  )
  const next = second.body.data.placeOrder.id
  const attempts = await Promise.all(
    ['ACCEPTED', 'CANCELLED'].map((status) =>
      gql(
        `mutation { setOrderStatus(input:{id:"${next}",expectedStatus:SUBMITTED,status:${status}${status === 'CANCELLED' ? ',cancellationReason:"No"' : ''}}) { status } }`,
      ),
    ),
  )
  expect(attempts.filter((result) => !result.body.errors)).toHaveLength(1)
  expect(attempts.find((result) => result.body.errors)?.body.errors[0].extensions.code).toBe(
    'CONFLICT',
  )
})
it('allows staff processing with live permissions and immutable attribution', async () => {
  const placed = await gql(
    'mutation { placeOrder(input:{items:[{bookId:"1",quantity:1}]}) { id } }',
    customer,
  )
  const id = placed.body.data.placeOrder.id
  db.exec("UPDATE user_roles SET role='STAFF'")
  const accepted = await gql(
    `mutation { setOrderStatus(input:{id:"${id}",expectedStatus:SUBMITTED,status:ACCEPTED}) { history { actorRole actorName } } }`,
  )
  expect(accepted.body.errors).toBeUndefined()
  expect(accepted.body.data.setOrderStatus.history[1]).toEqual({
    actorRole: 'STAFF',
    actorName: 'Reader',
  })
  db.exec("UPDATE user_roles SET role='CUSTOMER'")
  expect(
    (
      await gql(
        `mutation { setOrderStatus(input:{id:"${id}",expectedStatus:ACCEPTED,status:COMPLETED}) { status } }`,
      )
    ).body.errors[0].extensions.code,
  ).toBe('FORBIDDEN')
})

it('validates input before retries and retains the first cancellation reason', async () => {
  const placed = await gql(
    'mutation { placeOrder(input:{items:[{bookId:"1",quantity:1}]}) { id } }',
    customer,
  )
  const id = placed.body.data.placeOrder.id
  for (const input of [
    `id:"${id}",expectedStatus:SUBMITTED,status:CANCELLED,cancellationReason:"   "`,
    `id:"${id}",expectedStatus:SUBMITTED,status:CANCELLED,cancellationReason:"${'x'.repeat(501)}"`,
    `id:"${id}",expectedStatus:SUBMITTED,status:ACCEPTED,cancellationReason:"No"`,
    'id:"01",expectedStatus:SUBMITTED,status:ACCEPTED',
    'id:"9007199254740992",expectedStatus:SUBMITTED,status:ACCEPTED',
    'id:"999",expectedStatus:SUBMITTED,status:ACCEPTED',
  ]) {
    expect(
      (await gql(`mutation { setOrderStatus(input:{${input}}) { id } }`)).body.errors[0].extensions
        .code,
    ).toBe('BAD_USER_INPUT')
  }
  const cancel = (expected: string, reason: string) =>
    gql(
      `mutation { setOrderStatus(input:{id:"${id}",expectedStatus:${expected},status:CANCELLED,cancellationReason:"${reason}"}) { history { cancellationReason } } }`,
    )
  expect((await cancel('SUBMITTED', 'Original')).body.errors).toBeUndefined()
  const repeat = await cancel('ACCEPTED', 'Replacement')
  expect(repeat.body.errors).toBeUndefined()
  expect(repeat.body.data.setOrderStatus.history).toEqual([
    { cancellationReason: null },
    { cancellationReason: 'Original' },
  ])
})
