import { verifiedFixtureRequest, capturedFixtureSender } from './verified-auth-fixture.js'
import { deliveryOptions, reviewedInlineCheckout } from './delivery-fixtures.js'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { createApp } from '../src/app.js'
import { createDatabase } from '../src/database/connection.js'
import { seedBooks } from '../src/database/seed.js'
import { FakePaymentProvider } from './fake-payment-provider.js'
import { randomUUID } from 'node:crypto'
const options = {
  frontendOrigin: 'http://localhost:5173',
  authBaseURL: 'http://localhost:5173',
  emailSender: capturedFixtureSender,
  authSecret: 'admin-test-secret-at-least-thirty-two-characters',
}
let db: Database.Database
let app: Awaited<ReturnType<typeof createApp>>
let cookies: string[]
let customer: string[]
beforeEach(async () => {
  db = createDatabase(':memory:')
  seedBooks(db)
  app = await createApp(db, options, {
    ...deliveryOptions,
    provider: new FakePaymentProvider(),
  })
  for (const email of ['admin@example.com', 'customer@example.com']) {
    const res = await verifiedFixtureRequest(app, db, options)
      .post('/api/auth/sign-up/email')
      .set('Origin', options.frontendOrigin)
      .send({
        name: 'Reader',
        email,
        password: 'correct-horse-battery-staple',
      })
    expect(res.status).toBe(200)
    if (email.startsWith('admin')) {
      cookies = res.headers['set-cookie'] as string[]
      db.prepare("INSERT INTO user_roles (user_id, role) VALUES (?, 'ADMIN')").run(res.body.user.id)
    } else customer = res.headers['set-cookie'] as string[]
  }
})
afterEach(() => db.close())
const details = {
  title: ' New title ',
  author: ' Author ',
  genre: ' Unique genre ',
  description: ' Description ',
  priceCents: 1234,
}
function gql(query: string, variables = {}, auth: string[] = cookies) {
  const req = verifiedFixtureRequest(app, db, options)
    .post('/graphql')
    .set('Origin', options.frontendOrigin)
  if (auth.length) req.set('Cookie', auth)
  return req.send({
    query,
    variables,
  })
}
const create =
  'mutation ($input: CreateBookInput!) { createBook(input: $input) { id title stock archived } }'
const update =
  'mutation ($input: AdminBookDetailsInput!) { updateBook(id: "1", input: $input) { title stock } }'
const stock = 'mutation ($delta: Int!) { adjustBookStock(id: "1", delta: $delta) { stock } }'
it('exposes detail revisions and returns CONFLICT without writes for stale or invalid revisions', async () => {
  const mutation =
    'mutation ($input: AdminBookDetailsInput!, $revision: Int) { updateBook(id: "1", input: $input, expectedRevision: $revision) { title detailsRevision stock coverRevision } }'
  const first = await gql(mutation, { input: details, revision: 0 })
  expect(first.body.errors).toBeUndefined()
  expect(first.body.data.updateBook).toMatchObject({ detailsRevision: 1, title: 'New title' })
  const stale = await gql(mutation, { input: { ...details, title: 'Stale' }, revision: 0 })
  expect(stale.body.errors[0].extensions.code).toBe('CONFLICT')
  const invalid = await gql(mutation, { input: details, revision: -1 })
  expect(invalid.body.errors[0].extensions.code).toBe('BAD_USER_INPUT')
  const noChange = await gql(mutation, { input: details, revision: 1 })
  expect(noChange.body.data.updateBook.detailsRevision).toBe(2)
  const legacy = await gql(mutation, { input: details })
  expect(legacy.body.data.updateBook.detailsRevision).toBe(3)
  const current = await gql('{ adminBook(id: "1") { title detailsRevision } }')
  expect(current.body.data.adminBook).toEqual({ title: 'New title', detailsRevision: 3 })
  expect(
    db.prepare("SELECT count(*) AS n FROM activity_events WHERE action = 'BOOK_UPDATED'").get(),
  ).toEqual({ n: 1 })
})
it('creates trimmed books, preserves checkout stock on metadata edits, and applies bounded deltas', async () => {
  const created = await gql(create, {
    input: {
      details,
      stock: 4,
    },
  })
  expect(created.body.errors).toBeUndefined()
  expect(created.body.data.createBook).toMatchObject({
    title: 'New title',
    stock: 4,
    archived: false,
  })
  const placed = await gql(
    reviewedInlineCheckout(
      db,
      `mutation { createCheckout(input: { requestKey:"${randomUUID()}", items: [{ bookId: "1", quantity: 2 }] }) { order { id } } }`,
    ),
  )
  expect(placed.body.errors).toBeUndefined()
  expect(
    (
      await gql(update, {
        input: details,
      })
    ).body.data.updateBook.stock,
  ).toBe(10)
  expect(
    (
      await gql(stock, {
        delta: 3,
      })
    ).body.data.adjustBookStock.stock,
  ).toBe(13)
  expect(
    (
      await gql(stock, {
        delta: -14,
      })
    ).body.errors[0].extensions.code,
  ).toBe('BAD_USER_INPUT')
  expect(db.prepare('SELECT stock FROM books WHERE id = 1').get()).toEqual({
    stock: 13,
  })
  expect(
    (
      await gql(stock, {
        delta: 0,
      })
    ).body.errors[0].extensions.code,
  ).toBe('BAD_USER_INPUT')
})
it('archives atomically, removes public books and genres, retains old snapshots, and restores', async () => {
  await gql(update, {
    input: details,
  })
  await gql(
    reviewedInlineCheckout(
      db,
      `mutation { createCheckout(input: { requestKey:"${randomUUID()}", items: [{ bookId: "1", quantity: 1 }] }) { order { id } } }`,
    ),
  )
  const archived = await gql('mutation { setBookArchived(id: "1", archived: true) { archived } }')
  expect(archived.body.errors).toBeUndefined()
  expect((await gql('{ book(id: "1") { id } genres }')).body.data).toMatchObject({
    book: null,
  })
  expect((await gql('{ genres }')).body.data.genres).not.toContain('Unique genre')
  const failed = await gql(
    reviewedInlineCheckout(
      db,
      `mutation { createCheckout(input: { requestKey:"${randomUUID()}", items: [{ bookId: "2", quantity: 1 }, { bookId: "1", quantity: 1 }] }) { order { id } } }`,
    ),
  )
  expect(failed.body.errors[0].extensions.code).toBe('BAD_USER_INPUT')
  expect(db.prepare('SELECT count(*) AS count FROM orders').get()).toEqual({
    count: 1,
  })
  expect(db.prepare('SELECT title, unit_price_cents FROM order_items').get()).toEqual({
    title: 'New title',
    unit_price_cents: 1234,
  })
  expect(
    (await gql('mutation { setBookArchived(id: "1", archived: false) { id archived } }')).body.data
      .setBookArchived,
  ).toEqual({
    id: '1',
    archived: false,
  })
  expect((await gql('{ book(id: "1") { id } }')).body.data.book.id).toBe('1')
})
it('authorizes every admin book field before lookup, including aliases and mixed operations', async () => {
  const operations = [
    '{ hidden: adminBooks { total } }',
    '{ adminBook(id: "999") { id } }',
    'mutation { createBook(input: { details: { title: "T", author: "A", genre: "G", description: "D", priceCents: 1 }, stock: 1 }) { id } }',
    'mutation { updateBook(id: "999", input: { title: "T", author: "A", genre: "G", description: "D", priceCents: 1 }) { id } }',
    'mutation { adjustBookStock(id: "999", delta: 0) { id } }',
    'mutation { setBookArchived(id: "999", archived: true) { id } }',
    '{ books { total } private: adminBook(id: "999") { id } }',
  ]
  for (const query of operations) {
    expect((await gql(query, {}, customer)).body.errors[0].extensions.code).toBe('FORBIDDEN')
    expect((await gql(query, {}, [])).body.errors[0].extensions.code).toBe('UNAUTHENTICATED')
  }
})
it('validates limits and IDs and filters literal search, archive state, and low stock before pagination', async () => {
  for (const input of [
    {
      ...details,
      title: ' ',
    },
    {
      ...details,
      author: 'x'.repeat(201),
    },
    {
      ...details,
      genre: 'x'.repeat(101),
    },
    {
      ...details,
      description: 'x'.repeat(5001),
    },
    {
      ...details,
      priceCents: 1000001,
    },
  ]) {
    expect(
      (
        await gql(create, {
          input: {
            details: input,
            stock: 1,
          },
        })
      ).body.errors[0].extensions.code,
    ).toBe('BAD_USER_INPUT')
  }
  expect((await gql('{ adminBook(id: "0") { id } }')).body.errors[0].extensions.code).toBe(
    'BAD_USER_INPUT',
  )
  expect((await gql('{ adminBook(id: "999") { id } }')).body.data.adminBook).toBeNull()
  expect((await gql('{ adminBooks(limit: 51) { total } }')).body.errors[0].extensions.code).toBe(
    'BAD_USER_INPUT',
  )
  await gql(create, {
    input: {
      details: {
        ...details,
        title: 'literal %',
      },
      stock: 0,
    },
  })
  const result = await gql(
    '{ adminBooks(search: "%", lowStockOnly: true, limit: 1) { total items { title stock } } }',
  )
  expect(result.body.data.adminBooks).toEqual({
    total: 1,
    items: [
      {
        title: 'literal %',
        stock: 0,
      },
    ],
  })
  await gql('mutation { setBookArchived(id: "1", archived: true) { id } }')
  expect(
    (await gql('{ adminBooks(filter: ARCHIVED) { total items { id } } }')).body.data.adminBooks,
  ).toEqual({
    total: 1,
    items: [
      {
        id: '1',
      },
    ],
  })
  expect(
    (await gql('{ adminBooks(filter: ALL, offset: 1000) { total items { id } } }')).body.data
      .adminBooks.items,
  ).toEqual([])
})
