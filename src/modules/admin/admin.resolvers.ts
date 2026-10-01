import type Database from 'better-sqlite3'
import type { QueryResolvers } from '../../graphql/generated/resolvers.js'
import { UserRole } from '../../graphql/generated/resolvers.js'
import type { GraphQLContext } from '../../graphql/context.js'
import { createAdminRepository } from './admin.repository.js'

export function createAdminResolvers(
  db: Database.Database,
): Pick<QueryResolvers<GraphQLContext>, 'viewer'> {
  const repository = createAdminRepository(db)
  return {
    viewer: (_, _args, { user }) =>
      user
        ? { id: user.id, role: repository.isAdmin(user.id) ? UserRole.Admin : UserRole.Customer }
        : null,
  }
}
