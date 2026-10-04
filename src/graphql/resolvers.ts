import type Database from 'better-sqlite3'
import type { Resolvers } from './generated/resolvers.js'
import { createBookResolvers } from '../modules/books/book.resolvers.js'
import { createOrderResolvers } from '../modules/orders/order.resolvers.js'
import type { GraphQLContext } from './context.js'
import { createAdminResolvers } from '../modules/admin/admin.resolvers.js'
import { createAdminBookResolvers } from '../modules/books/admin-book.resolvers.js'
import { createAdminOrderResolvers } from '../modules/orders/admin-order.resolvers.js'

export function createResolvers(db: Database.Database): Resolvers<GraphQLContext> {
  const orderResolvers = createOrderResolvers(db)
  const adminBooks = createAdminBookResolvers(db)
  const admin = createAdminResolvers(db)
  return {
    Query: {
      ...createBookResolvers(db),
      ...orderResolvers.Query,
      ...admin.Query,
      ...adminBooks.Query,
      ...createAdminOrderResolvers(db),
    },
    Mutation: { ...orderResolvers.Mutation, ...adminBooks.Mutation, ...admin.Mutation },
  }
}
