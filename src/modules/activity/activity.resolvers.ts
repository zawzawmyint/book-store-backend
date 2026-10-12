import type { GraphQLContext } from '../../graphql/context.js'
import type { QueryResolvers } from '../../graphql/generated/resolvers.js'
import { rethrowResolverError } from '../../graphql/errors.js'
import { createPermissionGuard } from '../admin/admin.authorization.js'
import type { AdminRepository } from '../admin/admin.repository.js'
import type { ActivityRepository } from './activity.repository.js'
import { createActivityService } from './activity.service.js'

export function createActivityResolvers(
  repository: ActivityRepository,
  adminRepository: AdminRepository,
): Pick<QueryResolvers<GraphQLContext>, 'adminActivity'> {
  const guard = createPermissionGuard(adminRepository.getUserRole)
  const activityService = createActivityService(repository)
  return {
    adminActivity: async (_, args, context) => {
      await guard(context.user, 'VIEW_ACTIVITY')
      try {
        return await activityService.list(
          Object.fromEntries(Object.entries(args).filter(([, value]) => value != null)),
        )
      } catch (error) {
        return rethrowResolverError(error)
      }
    },
  }
}
