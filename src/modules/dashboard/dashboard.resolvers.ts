import type { QueryResolvers } from '../../graphql/generated/resolvers.js'
import type { GraphQLContext } from '../../graphql/context.js'
import { rethrowResolverError } from '../../graphql/errors.js'
import { createPermissionGuard } from '../admin/admin.authorization.js'
import type { AdminRepository } from '../admin/admin.repository.js'
import type { DashboardRepository } from './dashboard.repository.js'
import { createDashboardService } from './dashboard.service.js'

export function createDashboardResolvers(
  repository: DashboardRepository,
  adminRepository: AdminRepository,
): Pick<QueryResolvers<GraphQLContext>, 'workspaceDashboard' | 'adminDashboardFinance'> {
  const guard = createPermissionGuard(adminRepository.getUserRole)
  const dashboardService = createDashboardService(repository)
  return {
    workspaceDashboard: async (_, _args, context) => {
      await guard(context.user, 'VIEW_ORDERS')
      await guard(context.user, 'MANAGE_CATALOG')
      try {
        return await dashboardService.workspace()
      } catch (error) {
        return rethrowResolverError(error)
      }
    },
    adminDashboardFinance: async (_, args, context) => {
      await guard(context.user, 'VIEW_DASHBOARD_FINANCE')
      try {
        return await dashboardService.finance(args.period)
      } catch (error) {
        return rethrowResolverError(error)
      }
    },
  }
}
