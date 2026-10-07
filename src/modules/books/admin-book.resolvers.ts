import type Database from 'better-sqlite3'
import type { AuthenticatedUser, GraphQLContext } from '../../graphql/context.js'
import type { QueryResolvers, MutationResolvers } from '../../graphql/generated/resolvers.js'
import { rethrowResolverError } from '../../graphql/errors.js'
import { createPermissionGuard, type Permission } from '../admin/admin.authorization.js'
import { createAdminRepository } from '../admin/admin.repository.js'
import { createAdminBookService } from './admin-book.service.js'
import { createAdminBookRepository } from './admin-book.repository.js'

export function createAdminBookResolvers(db: Database.Database): {
  Query: Pick<QueryResolvers<GraphQLContext>, 'adminBooks' | 'adminBook'>
  Mutation: Pick<
    MutationResolvers<GraphQLContext>,
    'createBook' | 'updateBook' | 'adjustBookStock' | 'setBookArchived'
  >
} {
  const adminRepository = createAdminRepository(db)
  const guard = createPermissionGuard(adminRepository.getUserRole)
  const service = createAdminBookService(createAdminBookRepository(db))
  const run = <T>(
    context: GraphQLContext,
    action: (user: AuthenticatedUser) => T,
    permission: Permission = 'MANAGE_CATALOG',
  ): T => {
    const user = guard(context.user, permission)
    try {
      return action(user)
    } catch (error) {
      return rethrowResolverError(error)
    }
  }
  return {
    Query: {
      adminBooks: (_, args, ctx) =>
        run(ctx, () =>
          service.list({
            search: args.search ?? '',
            filter: args.filter ?? 'ACTIVE',
            lowStockOnly: args.lowStockOnly ?? false,
            limit: args.limit ?? 20,
            offset: args.offset ?? 0,
          }),
        ),
      adminBook: (_, args, ctx) => run(ctx, () => service.get(args.id)),
    },
    Mutation: {
      createBook: (_, args, ctx) =>
        run(ctx, (user) => service.create(args.input, adminRepository.getActivityActor(user.id))),
      updateBook: (_, args, ctx) =>
        run(ctx, (user) =>
          service.update(args.id, args.input, adminRepository.getActivityActor(user.id)),
        ),
      adjustBookStock: (_, args, ctx) =>
        run(ctx, (user) =>
          service.adjustStock(args.id, args.delta, adminRepository.getActivityActor(user.id)),
        ),
      setBookArchived: (_, args, ctx) =>
        run(
          ctx,
          (user) =>
            service.archive(args.id, args.archived, adminRepository.getActivityActor(user.id)),
          'ARCHIVE_BOOKS',
        ),
    },
  }
}
