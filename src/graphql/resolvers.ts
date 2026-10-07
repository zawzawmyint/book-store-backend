import type Database from 'better-sqlite3'
import { createAdminOrderRepository } from '../modules/orders/admin-order.repository.js'
import type { AdminOrderStatusEvent, Resolvers } from './generated/resolvers.js'
import { createBookResolvers } from '../modules/books/book.resolvers.js'
import { createOrderResolvers } from '../modules/orders/order.resolvers.js'
import type { GraphQLContext } from './context.js'
import { createAdminResolvers } from '../modules/admin/admin.resolvers.js'
import { createAdminBookResolvers } from '../modules/books/admin-book.resolvers.js'
import { createAdminOrderResolvers } from '../modules/orders/admin-order.resolvers.js'
import { createActivityResolvers } from '../modules/activity/activity.resolvers.js'

export function createResolvers(db: Database.Database): Resolvers<GraphQLContext> {
  const orderResolvers = createOrderResolvers(db)
  const adminBooks = createAdminBookResolvers(db)
  const admin = createAdminResolvers(db)
  const workspaceOrders = createAdminOrderRepository(db)
  return {
    AdminOrder: {
      history: (order) => workspaceOrders.history(order.id) as AdminOrderStatusEvent[],
    },
    Query: {
      ...createBookResolvers(db),
      ...orderResolvers.Query,
      ...admin.Query,
      ...adminBooks.Query,
      ...createAdminOrderResolvers(db),
      ...createActivityResolvers(db),
    },
    Mutation: { ...orderResolvers.Mutation, ...adminBooks.Mutation, ...admin.Mutation },
  }
}
