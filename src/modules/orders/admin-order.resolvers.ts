import type { QueryResolvers } from '../../graphql/generated/resolvers.js'
import type { GraphQLContext } from '../../graphql/context.js'
import { rethrowResolverError } from '../../graphql/errors.js'
import { createPermissionGuard } from '../admin/admin.authorization.js'
import type { createAdminRepository } from '../admin/admin.repository.js'
import type { createAdminOrderRepository } from './admin-order.repository.js'
import { createAdminOrderService } from './admin-order.service.js'

export function createAdminOrderResolvers(
  repository: ReturnType<typeof createAdminOrderRepository>,
  roles: ReturnType<typeof createAdminRepository>,
): Pick<QueryResolvers<GraphQLContext>, 'adminOrders' | 'adminOrder'> {
  const guard = createPermissionGuard(roles.getUserRole)
  const service = createAdminOrderService(repository)
  return {
    adminOrders: async (_, args, context) => {
      await guard(context.user, 'VIEW_ORDERS')
      try {
        return await service.list(
          args.limit ?? 20,
          args.offset ?? 0,
          args.status ?? 'ALL',
          args.search ?? '',
        )
      } catch (error) {
        return rethrowResolverError(error)
      }
    },
    adminOrder: async (_, args, context) => {
      await guard(context.user, 'VIEW_ORDERS')
      try {
        return await service.get(args.id)
      } catch (error) {
        return rethrowResolverError(error)
      }
    },
  }
}
