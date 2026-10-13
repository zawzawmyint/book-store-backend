import { afterEach, beforeEach, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { createDatabase } from '../src/database/connection.js'
import { createApp } from '../src/app.js'
import { seedBooks } from '../src/database/seed.js'
import { verifiedFixtureRequest, capturedFixtureSender } from './verified-auth-fixture.js'
import { randomUUID } from 'node:crypto'
import { FakePaymentProvider } from './fake-payment-provider.js'
import { deliveryAddress, deliveryOptions } from './delivery-fixtures.js'

const options = {
  frontendOrigin: 'http://localhost:5173',
  authBaseURL: 'http://localhost:4000',
  authSecret: 'test-secret-that-is-at-least-thirty-two-characters-long',
  emailSender: capturedFixtureSender,
}
let db: Database.Database, app: Awaited<ReturnType<typeof createApp>>
beforeEach(async () => {
  db = createDatabase(':memory:')
  seedBooks(db)
  app = await createApp(db, options, { ...deliveryOptions, provider: new FakePaymentProvider() })
})
afterEach(async () => {
  await app.locals.close()
  db.close()
})
const fields =
  'revision items { bookId quantity lineVersion title priceCents stock available } mergeNotices { bookId reason }'
async function graphql(query: string, input?: unknown, cookie?: string[], expectedOwner?: string) {
  const req = verifiedFixtureRequest(app, db, options)
    .post('/graphql')
    .set('Origin', options.frontendOrigin)
  if (cookie) req.set('Cookie', cookie)
  if (expectedOwner) req.set('X-Cart-Account', expectedOwner)
  return (await req.send({ query, variables: { input } })).body
}
async function signup(email: string) {
  const response = await verifiedFixtureRequest(app, db, options)
    .post('/api/auth/sign-up/email')
    .set('Origin', options.frontendOrigin)
    .send({ name: 'Reader', email, password: 'correct-horse-battery-staple' })
  expect(response.status).toBe(200)
  return response.headers['set-cookie'] as string[]
}
it('requires a verified session for all cart operations', async () => {
  const result = await graphql(`query { myCart { ${fields} } }`)
  expect(result.errors[0].extensions.code).toBe('UNAUTHENTICATED')
})
it('gives Customer, Staff and Admin the same own-cart contract without cross-account privilege', async () => {
  const mutation = `mutation($input:SetCartItemInput!) { setCartItem(input:$input) { revision items { bookId } } }`
  for (const role of ['CUSTOMER', 'STAFF', 'ADMIN']) {
    const email = `${role.toLowerCase()}-cart@example.com`,
      cookie = await signup(email)
    const user = db.prepare('SELECT id FROM user WHERE email=?').get(email) as { id: string }
    db.prepare('INSERT INTO user_roles(user_id,role) VALUES(?,?)').run(user.id, role)
    expect(
      (
        await graphql(
          `
            query {
              myCart {
                revision
                items {
                  bookId
                }
              }
            }
          `,
          undefined,
          cookie,
        )
      ).data.myCart,
    ).toEqual({ revision: '0', items: [] })
    const response = await graphql(
      mutation,
      { bookId: '1', quantity: 1, expectedRevision: '0', requestKey: randomUUID() },
      cookie,
      user.id,
    )
    expect(response.errors).toBeUndefined()
    expect(response.data.setCartItem).toEqual({ revision: '1', items: [{ bookId: '1' }] })
  }
})
it('rejects a cart operation whose intended account differs from the current cookie', async () => {
  const a = await signup('intent@example.com')
  const input = { bookId: '1', quantity: 1, expectedRevision: '0', requestKey: randomUUID() }
  const result = await graphql(
    `
      mutation ($input: SetCartItemInput!) {
        setCartItem(input: $input) {
          revision
        }
      }
    `,
    input,
    a,
    'earlier-account',
  )
  expect(result.errors[0].extensions.code).toBe('UNAUTHENTICATED')
  expect(db.prepare('SELECT count(*) AS n FROM account_carts').get()).toEqual({ n: 0 })
})
it('rejects an earlier account checkout intent before order creation or stock reservation', async () => {
  const a = await signup('checkout-a@example.com'),
    b = await signup('checkout-b@example.com')
  const aUser = db.prepare('SELECT id FROM user WHERE email=?').get('checkout-a@example.com') as {
    id: string
  }
  const mutation = 'mutation($input:SetCartItemInput!) { setCartItem(input:$input) { revision } }'
  for (const cookie of [a, b])
    await graphql(
      mutation,
      { bookId: '1', quantity: 1, expectedRevision: '0', requestKey: randomUUID() },
      cookie,
    )
  const before = db.prepare('SELECT * FROM account_cart_items ORDER BY user_id').all()
  const response = await graphql(
    'mutation($input:CreateCheckoutInput!){ createCheckout(input:$input){ order { id } } }',
    {
      items: [{ bookId: '1', quantity: 1 }],
      requestKey: randomUUID(),
      cartRevision: '1',
      deliveryAddress,
      expectedDeliveryFeeCents: 500,
      expectedTotalCents: 2199,
    },
    b,
    aUser.id,
  )
  expect(response.errors[0].extensions.code).toBe('UNAUTHENTICATED')
  expect(db.prepare('SELECT count(*) AS n FROM orders').get()).toEqual({ n: 0 })
  expect(db.prepare('SELECT stock FROM books WHERE id=1').get()).toEqual({ stock: 12 })
  expect(db.prepare('SELECT * FROM account_cart_items ORDER BY user_id').all()).toEqual(before)
})
it('persists only the session owner cart and replays operations before checking revisions', async () => {
  const a = await signup('a@example.com'),
    b = await signup('b@example.com')
  const input = { bookId: '1', quantity: 2, expectedRevision: '0', requestKey: randomUUID() }
  const mutation = `mutation($input: SetCartItemInput!) { setCartItem(input:$input) { ${fields} } }`
  const saved = await graphql(mutation, input, a)
  expect(saved.errors).toBeUndefined()
  expect(saved.data.setCartItem).toMatchObject({
    revision: '1',
    items: [{ bookId: '1', quantity: 2, available: true }],
  })
  expect((await graphql(`query { myCart { ${fields} } }`, undefined, b)).data.myCart.items).toEqual(
    [],
  )
  expect((await graphql(mutation, input, a)).data.setCartItem.revision).toBe('1')
  expect(
    (await graphql(mutation, { ...input, requestKey: randomUUID(), quantity: 3 }, a)).errors[0]
      .extensions.code,
  ).toBe('CART_CONFLICT')
  expect((await graphql(mutation, { ...input, quantity: 3 }, a)).errors[0].extensions.code).toBe(
    'BAD_USER_INPUT',
  )
  expect(db.prepare('SELECT stock FROM books WHERE id=1').get()).toEqual({ stock: 12 })
})
it('merges a guest snapshot once with stock caps and durable adjustment notices', async () => {
  const a = await signup('merge@example.com')
  db.exec('UPDATE books SET stock=3 WHERE id=1; UPDATE books SET archived=1 WHERE id=2')
  const mutation = `mutation($input: MergeGuestCartInput!) { mergeGuestCart(input:$input) { ${fields} } }`
  const input = {
    items: [
      { bookId: '2', quantity: 2 },
      { bookId: '1', quantity: 8 },
    ],
    expectedRevision: '0',
    requestKey: randomUUID(),
  }
  const result = await graphql(mutation, input, a)
  expect(result.errors).toBeUndefined()
  expect(result.data.mergeGuestCart).toMatchObject({
    revision: '1',
    items: [{ bookId: '1', quantity: 3 }],
    mergeNotices: [
      { bookId: '1', reason: 'QUANTITY_LIMIT' },
      { bookId: '2', reason: 'UNAVAILABLE' },
    ],
  })
  expect(
    (
      await graphql(
        mutation,
        { ...input, expectedRevision: '1', items: [...input.items].reverse() },
        a,
      )
    ).data.mergeGuestCart,
  ).toEqual(result.data.mergeGuestCart)
})
