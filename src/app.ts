import express from 'express'
import cors from 'cors'
import { ApolloServer } from '@apollo/server'
import { expressMiddleware } from '@as-integrations/express5'
import type Database from 'better-sqlite3'
import type { BookRow } from './db.js'
import { createStore } from './store.js'

const typeDefs = `#graphql
  type Book {
    id: ID!
    title: String!
    author: String!
    genre: String!
    description: String!
    priceCents: Int!
    stock: Int!
  }
  type BookPage { total: Int!, items: [Book!]! }
  type OrderItem { title: String!, quantity: Int!, unitPriceCents: Int! }
  type OrderReceipt { id: ID!, totalCents: Int!, items: [OrderItem!]! }
  input OrderItemInput { bookId: ID!, quantity: Int! }
  input PlaceOrderInput { customerName: String!, email: String!, items: [OrderItemInput!]! }
  type Query {
    books(search: String, limit: Int = 12, offset: Int = 0): BookPage!
    book(id: ID!): Book
  }
  type Mutation { placeOrder(input: PlaceOrderInput!): OrderReceipt! }
`

export async function createApp(db: Database.Database) {
  const store = createStore(db)
  const server = new ApolloServer({
    typeDefs,
    resolvers: {
      Book: { priceCents: (book: BookRow) => book.price_cents },
      Query: {
        books: (_: unknown, args: { search?: string; limit?: number; offset?: number }) =>
          store.listBooks(args.search, args.limit, args.offset),
        book: (_: unknown, args: { id: string }) => store.getBook(args.id),
      },
      Mutation: {
        placeOrder: (_: unknown, args: { input: Parameters<typeof store.placeOrder>[0] }) =>
          store.placeOrder(args.input),
      },
    },
  })
  await server.start()
  const app = express()
  app.disable('x-powered-by')
  app.get('/health', (_req, res) => res.json({ status: 'ok' }))
  app.use(
    '/graphql',
    cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173' }),
    express.json({ limit: '100kb' }),
    expressMiddleware(server),
  )
  return app
}
