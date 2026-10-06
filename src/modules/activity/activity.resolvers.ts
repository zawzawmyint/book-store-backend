import type Database from 'better-sqlite3'
import type { GraphQLContext } from '../../graphql/context.js'
import type { QueryResolvers } from '../../graphql/generated/resolvers.js'
import { asGraphQLError } from '../../graphql/errors.js'
import { createPermissionGuard } from '../admin/admin.authorization.js'
import { createAdminRepository } from '../admin/admin.repository.js'
import { createActivityRepository } from './activity.repository.js'
import { createActivityService } from './activity.service.js'

export function createActivityResolvers(
  db: Database.Database,
): Pick<QueryResolvers<GraphQLContext>, 'adminActivity'> {
  const guard = createPermissionGuard(createAdminRepository(db).getUserRole)
  const service = createActivityService(createActivityRepository(db))
  return {
    adminActivity: (_, args, context) => {
      guard(context.user, 'VIEW_ACTIVITY')
      try {
        return service.list(
          Object.fromEntries(Object.entries(args).filter(([, value]) => value != null)),
        )
      } catch (error) {
        return asGraphQLError(error)
      }
    },
  }
}
