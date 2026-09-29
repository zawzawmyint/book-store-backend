import type Database from 'better-sqlite3'
import { GraphQLError } from 'graphql'
import { createCatalogRepository, type BookRow } from './catalog.js'
import { ValidationError } from './errors.js'
import { createOrderService, type OrderInput } from './orders.js'

export const typeDefs = `#graphql
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

function asGraphQLError(error: unknown): never {
  if (error instanceof ValidationError) {
    throw new GraphQLError(error.message, { extensions: { code: 'BAD_USER_INPUT' } })
  }
  throw error
}

export function createResolvers(db: Database.Database) {
  const catalog = createCatalogRepository(db)
  const orders = createOrderService(db)

  return {
    Book: { priceCents: (book: BookRow) => book.price_cents },
    Query: {
      books: (_: unknown, args: { search?: string; limit?: number; offset?: number }) => {
        try {
          return catalog.listBooks(args.search, args.limit, args.offset)
        } catch (error) {
          return asGraphQLError(error)
        }
      },
      book: (_: unknown, args: { id: string }) => catalog.getBook(args.id),
    },
    Mutation: {
      placeOrder: (_: unknown, args: { input: OrderInput }) => {
        try {
          return orders.placeOrder(args.input)
        } catch (error) {
          return asGraphQLError(error)
        }
      },
    },
  }
}
