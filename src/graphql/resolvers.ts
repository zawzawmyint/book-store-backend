import { normalizeStore } from '../database/persistence.js'
import { readDelivery } from '../modules/orders/delivery.mapping.js'
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
import type { PaymentService } from '../modules/payments/payment.service.js'
import { createDashboardRepository } from '../modules/dashboard/dashboard.repository.js'
import { createDashboardResolvers } from '../modules/dashboard/dashboard.resolvers.js'

export function createResolvers(
  db: DatabaseInput,
  paymentService: PaymentService,
): Resolvers<GraphQLContext> {
  const adminRepository = createAdminRepository(db)
  const orderRepository = createOrderRepository(db)
  const adminBookRepository = createAdminBookRepository(db)
  const dashboardRepository = createDashboardRepository(db)
  const catalogRepository = createCatalogRepository(db)
  const adminOrderRepository = createAdminOrderRepository(db)
  const activityRepository = createActivityRepository(db)

  const orderResolvers = createOrderResolvers(orderRepository, adminRepository, paymentService)
  const adminBookResolvers = createAdminBookResolvers(adminBookRepository, adminRepository)
  const adminResolvers = createAdminResolvers(adminRepository)
  const dashboardResolvers = createDashboardResolvers(dashboardRepository, adminRepository)
  const bookResolvers = createBookResolvers(catalogRepository)
  const adminOrderResolvers = createAdminOrderResolvers(adminOrderRepository, adminRepository)
  const activityResolvers = createActivityResolvers(activityRepository, adminRepository)
  return {
    OrderHistoryEntry: {
      delivery: async (order) =>
        order.delivery ?? readDelivery(normalizeStore(db), Number(order.id)),
    },
    AdminOrder: {
      delivery: async (order) =>
        order.delivery ?? readDelivery(normalizeStore(db), Number(order.id)),
      history: async (order) =>
        (await adminOrderRepository.history(order.id)) as AdminOrderStatusEvent[],
    },
    Query: {
      ...dashboardResolvers,
      ...bookResolvers,
      ...orderResolvers.Query,
      ...adminResolvers.Query,
      ...adminBookResolvers.Query,
      ...adminOrderResolvers,
      ...activityResolvers,
    },
    Mutation: {
      ...orderResolvers.Mutation,
      ...adminBookResolvers.Mutation,
      ...adminResolvers.Mutation,
    },
  }
}
