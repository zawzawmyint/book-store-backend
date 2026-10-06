import type Database from 'better-sqlite3'
import type { QueryResolvers } from '../../graphql/generated/resolvers.js'
import type { GraphQLContext } from '../../graphql/context.js'
import { asGraphQLError } from '../../graphql/errors.js'
import { createPermissionGuard } from '../admin/admin.authorization.js'
import { createAdminRepository } from '../admin/admin.repository.js'
import { createAdminOrderRepository } from './admin-order.repository.js'
import { createAdminOrderService } from './admin-order.service.js'

export function createAdminOrderResolvers(
  db: Database.Database,
): Pick<QueryResolvers<GraphQLContext>, 'adminOrders' | 'adminOrder'> {
  const guard = createPermissionGuard(createAdminRepository(db).getUserRole)
  const service = createAdminOrderService(createAdminOrderRepository(db))
  return {
    adminOrders: (_, args, context) => {
      guard(context.user, 'VIEW_ORDERS')
      try {
        return service.list(args.limit ?? 20, args.offset ?? 0)
      } catch (error) {
        return asGraphQLError(error)
      }
    },
    adminOrder: (_, args, context) => {
      guard(context.user, 'VIEW_ORDERS')
      try {
        return service.get(args.id)
      } catch (error) {
        return asGraphQLError(error)
      }
    },
  }
}
