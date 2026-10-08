import { deliveryOptions, reviewedInput } from './delivery-fixtures.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { createDatabase } from '../src/database/connection.js'
import { seedBooks } from '../src/database/seed.js'
import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { FakePaymentProvider } from './fake-payment-provider.js'

const query = `query Books($search: String) { books(search: $search) { total items { id title author priceCents stock } } }`
const mutation = `mutation Order($input: CreateCheckoutInput!) { createCheckout(input: $input) { order { id totalCents items { title quantity unitPriceCents } } } }`
const authOptions = {
  frontendOrigin: 'http://localhost:5173',
  authBaseURL: 'http://localhost:4000',
  authSecret: 'test-secret-that-is-at-least-thirty-two-characters-long',
}

describe('book store GraphQL API', () => {
  let db: Database.Database
  let app: Awaited<ReturnType<typeof createApp>>
  let cookies: string[]

  beforeEach(async () => {
    db = createDatabase(':memory:')
    seedBooks(db)
    app = await createApp(db, authOptions, {
      ...deliveryOptions,
      provider: new FakePaymentProvider(),
    })
    const signUp = await request(app)
      .post('/api/auth/sign-up/email')
      .set('Origin', authOptions.frontendOrigin)
      .send({
        name: 'Ada Reader',
        email: 'ada@example.com',
        password: 'correct-horse-battery-staple',
      })
    cookies = signUp.headers['set-cookie'] as string[]
  })

  afterEach(() => db.close())

  it('lists and searches seeded books', async () => {
    const all = await request(app).post('/graphql').send({ query })
    expect(all.status).toBe(200)
    expect(all.body.data.books.total).toBeGreaterThanOrEqual(8)

    const searched = await request(app)
      .post('/graphql')
      .send({ query, variables: { search: 'gatsby' } })
    expect(searched.body.data.books.total).toBe(1)
    expect(searched.body.data.books.items[0].title).toBe('The Great Gatsby')
    const genre = await request(app)
      .post('/graphql')
      .send({ query, variables: { search: 'Gothic Fiction' } })
    expect(genre.body.data.books.total).toBe(2)
  })

  it('provides distinct catalog genres for storefront shortcuts', async () => {
    db.prepare(
      'INSERT INTO books (title, author, genre, description, price_cents, stock) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('A New Shelf', 'Test Author', 'New Genre', 'A test book', 1000, 1)
    const response = await request(app).post('/graphql').send({ query: '{ genres }' })
    expect(response.body.errors).toBeUndefined()
    expect(response.body.data.genres).toContain('Classic Fiction')
    expect(response.body.data.genres).toContain('New Genre')
    expect(response.body.data.genres).toEqual([...response.body.data.genres].sort())
    expect(new Set(response.body.data.genres).size).toBe(response.body.data.genres.length)
  })

  it('treats search wildcard characters literally', async () => {
    for (const search of ['%', '_', '\\']) {
      const response = await request(app).post('/graphql').send({ query, variables: { search } })
      expect(response.body.errors).toBeUndefined()
      expect(response.body.data.books.total).toBe(0)
    }
  })

  it('reports invalid input as a client error', async () => {
    const page = await request(app)
      .post('/graphql')
      .send({ query: '{ books(limit: 100) { total } }' })
    expect(page.body.errors[0].extensions.code).toBe('BAD_USER_INPUT')
    expect(page.body.errors[0].message).toBe('Too big: expected number to be <=24')

    const order = await request(app)
      .post('/graphql')
      .set('Origin', authOptions.frontendOrigin)
      .set('Cookie', cookies)
      .send({
        query: mutation,
        variables: {
          input: {
            ...reviewedInput(db, {
              requestKey: randomUUID(),
              items: [{ bookId: '1', quantity: 0 }],
            }),
          },
        },
      })
    expect(order.body.errors[0].extensions.code).toBe('BAD_USER_INPUT')
    expect(db.prepare('SELECT COUNT(*) AS count FROM orders').get()).toEqual({ count: 0 })
  })

  it('retains nullable public lookups and numeric ID compatibility', async () => {
    const response = await request(app).post('/graphql').send({
      query:
        '{ leading: book(id: "01") { id } invalid: book(id: "abc") { id } missing: book(id: "99999") { id } }',
    })
    expect(response.body.errors).toBeUndefined()
    expect(response.body.data).toEqual({ leading: { id: '1' }, invalid: null, missing: null })
  })

  it('places an authenticated order using server prices and decrements stock', async () => {
    const order = await request(app)
      .post('/graphql')
      .set('Origin', authOptions.frontendOrigin)
      .set('Cookie', cookies)
      .send({
        query: mutation,
        variables: {
          input: {
            ...reviewedInput(db, {
              requestKey: randomUUID(),
              items: [{ bookId: '1', quantity: 2 }],
            }),
          },
        },
      })
    expect(order.body.errors).toBeUndefined()
    expect(order.body.data.createCheckout.order.totalCents).toBe(
      order.body.data.createCheckout.order.items[0].unitPriceCents * 2 + 500,
    )
    expect(db.prepare('SELECT COUNT(*) AS count FROM orders').get()).toEqual({ count: 1 })
    expect(
      (db.prepare('SELECT stock FROM books WHERE id = 1').get() as { stock: number }).stock,
    ).toBe(10)
  })

  it('rejects out of stock orders without saving anything', async () => {
    db.prepare('UPDATE books SET stock = 1 WHERE id = 1').run()
    const order = await request(app)
      .post('/graphql')
      .set('Origin', authOptions.frontendOrigin)
      .set('Cookie', cookies)
      .send({
        query: mutation,
        variables: {
          input: {
            ...reviewedInput(db, {
              requestKey: randomUUID(),
              items: [{ bookId: '1', quantity: 2 }],
            }),
          },
        },
      })
    expect(order.body.errors[0].message).toMatch(/stock/i)
    expect(db.prepare('SELECT COUNT(*) AS count FROM orders').get()).toEqual({ count: 0 })
  })

  it('does not write a partial order when one of two books is out of stock', async () => {
    db.prepare('UPDATE books SET stock = 0 WHERE id = 2').run()
    const order = await request(app)
      .post('/graphql')
      .set('Origin', authOptions.frontendOrigin)
      .set('Cookie', cookies)
      .send({
        query: mutation,
        variables: {
          input: {
            ...reviewedInput(db, {
              requestKey: randomUUID(),
              items: [
                { bookId: '1', quantity: 1 },
                { bookId: '2', quantity: 1 },
              ],
            }),
          },
        },
      })
    expect(order.body.errors[0].message).toMatch(/stock/i)
    expect(db.prepare('SELECT COUNT(*) AS count FROM orders').get()).toEqual({ count: 0 })
    expect(
      (db.prepare('SELECT stock FROM books WHERE id = 1').get() as { stock: number }).stock,
    ).toBe(12)
  })

  it('rolls back order rows and stock when a line insert fails after stock changes', async () => {
    db.exec(
      "CREATE TRIGGER reject_second_line BEFORE INSERT ON order_items WHEN NEW.book_id = 2 BEGIN SELECT RAISE(ABORT, 'forced line failure'); END",
    )
    const response = await request(app)
      .post('/graphql')
      .set('Origin', authOptions.frontendOrigin)
      .set('Cookie', cookies)
      .send({
        query: mutation,
        variables: {
          input: {
            ...reviewedInput(db, {
              requestKey: randomUUID(),
              items: [
                { bookId: '1', quantity: 1 },
                { bookId: '2', quantity: 1 },
              ],
            }),
          },
        },
      })
    expect(response.body.errors).toBeDefined()
    expect(db.prepare('SELECT COUNT(*) AS count FROM orders').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM order_items').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT stock FROM books WHERE id IN (1, 2) ORDER BY id').all()).toEqual([
      { stock: 12 },
      { stock: 15 },
    ])
  })
})
