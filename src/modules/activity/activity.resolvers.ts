import type { GraphQLContext } from '../../graphql/context.js'
import type { QueryResolvers } from '../../graphql/generated/resolvers.js'
import { rethrowResolverError } from '../../graphql/errors.js'
import { createPermissionGuard } from '../admin/admin.authorization.js'
import type { createAdminRepository } from '../admin/admin.repository.js'
import type { createActivityRepository } from './activity.repository.js'
import { createActivityService } from './activity.service.js'

export function createActivityResolvers(
  repository: ReturnType<typeof createActivityRepository>,
  roles: ReturnType<typeof createAdminRepository>,
): Pick<QueryResolvers<GraphQLContext>, 'adminActivity'> {
  const guard = createPermissionGuard(roles.getUserRole)
  const service = createActivityService(repository)
  return {
    adminActivity: async (_, args, context) => {
      await guard(context.user, 'VIEW_ACTIVITY')
      try {
        return await service.list(
          Object.fromEntries(Object.entries(args).filter(([, value]) => value != null)),
        )
      } catch (error) {
        return rethrowResolverError(error)
      }
    },
  }
}
