import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { createDatabase } from '../src/db.js'
import { seedBooks } from '../src/seed.js'
import type Database from 'better-sqlite3'

const query = `query Books($search: String) { books(search: $search) { total items { id title author priceCents stock } } }`
const mutation = `mutation Order($input: PlaceOrderInput!) { placeOrder(input: $input) { id totalCents items { title quantity unitPriceCents } } }`

describe('book store GraphQL API', () => {
  let db: Database.Database
  let app: Awaited<ReturnType<typeof createApp>>

  beforeEach(async () => {
    db = createDatabase(':memory:')
    seedBooks(db)
    app = await createApp(db)
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

  it('reports invalid input as a client error', async () => {
    const page = await request(app)
      .post('/graphql')
      .send({ query: '{ books(limit: 100) { total } }' })
    expect(page.body.errors[0].extensions.code).toBe('BAD_USER_INPUT')

    const order = await request(app)
      .post('/graphql')
      .send({
        query: mutation,
        variables: {
          input: {
            customerName: 'Ada Reader',
            email: 'invalid',
            items: [{ bookId: '1', quantity: 1 }],
          },
        },
      })
    expect(order.body.errors[0].extensions.code).toBe('BAD_USER_INPUT')
    expect(db.prepare('SELECT COUNT(*) AS count FROM orders').get()).toEqual({ count: 0 })
  })

  it('places a guest order using server prices and decrements stock', async () => {
    const order = await request(app)
      .post('/graphql')
      .send({
        query: mutation,
        variables: {
          input: {
            customerName: 'Ada Reader',
            email: 'ada@example.com',
            items: [{ bookId: '1', quantity: 2 }],
          },
        },
      })
    expect(order.body.errors).toBeUndefined()
    expect(order.body.data.placeOrder.totalCents).toBe(
      order.body.data.placeOrder.items[0].unitPriceCents * 2,
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
      .send({
        query: mutation,
        variables: {
          input: {
            customerName: 'Ada Reader',
            email: 'ada@example.com',
            items: [{ bookId: '1', quantity: 2 }],
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
      .send({
        query: mutation,
        variables: {
          input: {
            customerName: 'Ada Reader',
            email: 'ada@example.com',
            items: [
              { bookId: '1', quantity: 1 },
              { bookId: '2', quantity: 1 },
            ],
          },
        },
      })
    expect(order.body.errors[0].message).toMatch(/stock/i)
    expect(db.prepare('SELECT COUNT(*) AS count FROM orders').get()).toEqual({ count: 0 })
    expect(
      (db.prepare('SELECT stock FROM books WHERE id = 1').get() as { stock: number }).stock,
    ).toBe(12)
  })
})
