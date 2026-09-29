import type Database from 'better-sqlite3'
import { GraphQLError } from 'graphql'
import { createCatalogRepository, type BookRow } from '../modules/books/book.repository.js'
import { createBookService } from '../modules/books/book.service.js'
import { ValidationError } from '../shared/errors.js'
import { createOrderRepository } from '../modules/orders/order.repository.js'
import { createOrderService } from '../modules/orders/order.service.js'
import type { OrderInput } from '../modules/orders/order.types.js'

function asGraphQLError(error: unknown): never {
  if (error instanceof ValidationError) {
    throw new GraphQLError(error.message, { extensions: { code: 'BAD_USER_INPUT' } })
  }
  throw error
}

export function createResolvers(db: Database.Database) {
  const books = createBookService(createCatalogRepository(db))
  const orders = createOrderService(createOrderRepository(db))

  return {
    Book: { priceCents: (book: BookRow) => book.price_cents },
    Query: {
      books: (_: unknown, args: { search?: string; limit?: number; offset?: number }) => {
        try {
          return books.listBooks(args.search, args.limit, args.offset)
        } catch (error) {
          return asGraphQLError(error)
        }
      },
      book: (_: unknown, args: { id: string }) => books.getBook(args.id),
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
