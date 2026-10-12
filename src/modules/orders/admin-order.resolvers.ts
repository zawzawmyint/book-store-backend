import type { QueryResolvers } from '../../graphql/generated/resolvers.js'
import type { GraphQLContext } from '../../graphql/context.js'
import { rethrowResolverError } from '../../graphql/errors.js'
import { createPermissionGuard } from '../admin/admin.authorization.js'
import type { AdminRepository } from '../admin/admin.repository.js'
import type { AdminOrderRepository } from './admin-order.repository.js'
import { createAdminOrderService } from './admin-order.service.js'

export function createAdminOrderResolvers(
  repository: AdminOrderRepository,
  adminRepository: AdminRepository,
): Pick<QueryResolvers<GraphQLContext>, 'adminOrders' | 'adminOrder'> {
  const guard = createPermissionGuard(adminRepository.getUserRole)
  const adminOrderService = createAdminOrderService(repository)
  return {
    adminOrders: async (_, args, context) => {
      await guard(context.user, 'VIEW_ORDERS')
      try {
        return await adminOrderService.list({
          limit: args.limit ?? 20,
          offset: args.offset ?? 0,
          status: args.status ?? 'ALL',
          search: args.search ?? '',
        })
      } catch (error) {
        return rethrowResolverError(error)
      }
    },
    adminOrder: async (_, args, context) => {
      await guard(context.user, 'VIEW_ORDERS')
      try {
        return await adminOrderService.get(args.id)
      } catch (error) {
        return rethrowResolverError(error)
      }
    },
  }
}
