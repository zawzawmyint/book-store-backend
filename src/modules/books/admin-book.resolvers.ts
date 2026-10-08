import type { AuthenticatedUser, GraphQLContext } from '../../graphql/context.js'
import type { QueryResolvers, MutationResolvers } from '../../graphql/generated/resolvers.js'
import { rethrowResolverError } from '../../graphql/errors.js'
import { createPermissionGuard, type Permission } from '../admin/admin.authorization.js'
import type { createAdminRepository } from '../admin/admin.repository.js'
import { createAdminBookService } from './admin-book.service.js'
import type { createAdminBookRepository } from './admin-book.repository.js'

export function createAdminBookResolvers(
  repository: ReturnType<typeof createAdminBookRepository>,
  roles: ReturnType<typeof createAdminRepository>,
): {
  Query: Pick<QueryResolvers<GraphQLContext>, 'adminBooks' | 'adminBook'>
  Mutation: Pick<
    MutationResolvers<GraphQLContext>,
    'createBook' | 'updateBook' | 'adjustBookStock' | 'setBookArchived'
  >
} {
  const guard = createPermissionGuard(roles.getUserRole)
  const service = createAdminBookService(repository)
  const run = async <T>(
    context: GraphQLContext,
    action: (user: AuthenticatedUser) => T,
    permission: Permission = 'MANAGE_CATALOG',
  ): Promise<Awaited<T>> => {
    const user = await guard(context.user, permission)
    try {
      return await action(user)
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
        run(ctx, async (user) => service.create(args.input, await roles.getActivityActor(user.id))),
      updateBook: (_, args, ctx) =>
        run(ctx, async (user) =>
          service.update(args.id, args.input, await roles.getActivityActor(user.id)),
        ),
      adjustBookStock: (_, args, ctx) =>
        run(ctx, async (user) =>
          service.adjustStock(args.id, args.delta, await roles.getActivityActor(user.id)),
        ),
      setBookArchived: (_, args, ctx) =>
        run(
          ctx,
          async (user) =>
            service.archive(args.id, args.archived, await roles.getActivityActor(user.id)),
          'ARCHIVE_BOOKS',
        ),
    },
  }
}
