import { createCatalogRepository } from '../modules/books/book.repository.js'
import { createAdminBookRepository } from '../modules/books/admin-book.repository.js'
import { createOrderRepository } from '../modules/orders/order.repository.js'
import { createAdminRepository } from '../modules/admin/admin.repository.js'
import { createActivityRepository } from '../modules/activity/activity.repository.js'
import type { DatabaseInput } from '../database/persistence.js'
import { createAdminOrderRepository } from '../modules/orders/admin-order.repository.js'
import type { AdminOrderStatusEvent, Resolvers } from './generated/resolvers.js'
import { createBookResolvers } from '../modules/books/book.resolvers.js'
import { createOrderResolvers } from '../modules/orders/order.resolvers.js'
import type { GraphQLContext } from './context.js'
import { createAdminResolvers } from '../modules/admin/admin.resolvers.js'
import { createAdminBookResolvers } from '../modules/books/admin-book.resolvers.js'
import { createAdminOrderResolvers } from '../modules/orders/admin-order.resolvers.js'
import { createActivityResolvers } from '../modules/activity/activity.resolvers.js'
import type { createPaymentService } from '../modules/payments/payment.service.js'

export function createResolvers(
  db: DatabaseInput,
  payments: ReturnType<typeof createPaymentService>,
): Resolvers<GraphQLContext> {
  const roles = createAdminRepository(db)
  const orderResolvers = createOrderResolvers(createOrderRepository(db), roles, payments)
  const adminBooks = createAdminBookResolvers(createAdminBookRepository(db), roles)
  const admin = createAdminResolvers(roles)
  const workspaceOrders = createAdminOrderRepository(db)
  return {
    AdminOrder: {
      history: async (order) =>
        (await workspaceOrders.history(order.id)) as AdminOrderStatusEvent[],
    },
    Query: {
      ...createBookResolvers(createCatalogRepository(db)),
      ...orderResolvers.Query,
      ...admin.Query,
      ...adminBooks.Query,
      ...createAdminOrderResolvers(workspaceOrders, roles),
      ...createActivityResolvers(createActivityRepository(db), roles),
    },
    Mutation: { ...orderResolvers.Mutation, ...adminBooks.Mutation, ...admin.Mutation },
  }
}
