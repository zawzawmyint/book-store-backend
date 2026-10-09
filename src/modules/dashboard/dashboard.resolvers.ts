import type { QueryResolvers } from '../../graphql/generated/resolvers.js'
import type { GraphQLContext } from '../../graphql/context.js'
import { rethrowResolverError } from '../../graphql/errors.js'
import { createPermissionGuard } from '../admin/admin.authorization.js'
import type { createAdminRepository } from '../admin/admin.repository.js'
import type { createDashboardRepository } from './dashboard.repository.js'
import { createDashboardService } from './dashboard.service.js'

export function createDashboardResolvers(
  repository: ReturnType<typeof createDashboardRepository>,
  roles: ReturnType<typeof createAdminRepository>,
): Pick<QueryResolvers<GraphQLContext>, 'workspaceDashboard' | 'adminDashboardFinance'> {
  const guard = createPermissionGuard(roles.getUserRole)
  const service = createDashboardService(repository)
  return {
    workspaceDashboard: async (_, _args, context) => {
      await guard(context.user, 'VIEW_ORDERS')
      await guard(context.user, 'MANAGE_CATALOG')
      try {
        return await service.workspace()
      } catch (error) {
        return rethrowResolverError(error)
      }
    },
    adminDashboardFinance: async (_, args, context) => {
      await guard(context.user, 'VIEW_DASHBOARD_FINANCE')
      try {
        return await service.finance(args.period)
      } catch (error) {
        return rethrowResolverError(error)
      }
    },
  }
}
