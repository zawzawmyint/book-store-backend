import type { MyOrder, MyOrdersPage, OrderReceipt } from '../../graphql/generated/resolvers.js'
import type Database from 'better-sqlite3'
import type { MutationResolvers, QueryResolvers } from '../../graphql/generated/resolvers.js'
import type { GraphQLContext } from '../../graphql/context.js'
import { rethrowResolverError } from '../../graphql/errors.js'
import { createOrderRepository } from './order.repository.js'
import { createOrderService } from './order.service.js'
import { createAdminOrderRepository } from './admin-order.repository.js'
import { createAdminOrderService } from './admin-order.service.js'
import { createPermissionGuard } from '../admin/admin.authorization.js'
import { createAdminRepository } from '../admin/admin.repository.js'
import { requireUser } from '../../shared/authentication.js'

export function createOrderResolvers(db: Database.Database): {
  Query: Pick<QueryResolvers<GraphQLContext>, 'myOrders' | 'myOrder'>
  Mutation: Pick<MutationResolvers<GraphQLContext>, 'placeOrder' | 'setOrderStatus'>
} {
  const service = createOrderService(createOrderRepository(db))
  const workspace = createAdminOrderRepository(db)
  const workflow = createAdminOrderService(workspace)
  const roles = createAdminRepository(db)
  const guard = createPermissionGuard(roles.getUserRole)
  return {
    Query: {
      myOrder: (_, args, context) => {
        const user = requireUser(context.user)
        try {
          return service.myOrder(user.id, args.id) as MyOrder | null
        } catch (error) {
          return rethrowResolverError(error)
        }
      },
      myOrders: (_, args, context) => {
        const user = requireUser(context.user)
        try {
          return service.myOrders(user.id, args.limit ?? 20, args.offset ?? 0) as MyOrdersPage
        } catch (error) {
          return rethrowResolverError(error)
        }
      },
    },
    Mutation: {
      setOrderStatus: (_, args, context) => {
        const user = guard(context.user, 'PROCESS_ORDERS')
        try {
          return workflow.setStatus(args.input, {
            source: 'GRAPHQL',
            userId: user.id,
            name: user.name,
            role: roles.getUserRole(user.id),
          })
        } catch (error) {
          return rethrowResolverError(error)
        }
      },
      placeOrder: (_, args, context) => {
        const user = requireUser(context.user)
        try {
          return service.placeOrder(args.input, user) as OrderReceipt
        } catch (error) {
          return rethrowResolverError(error)
        }
      },
    },
  }
}
