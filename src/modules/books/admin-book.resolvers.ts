import type { AuthenticatedUser, GraphQLContext } from '../../graphql/context.js'
import type { QueryResolvers, MutationResolvers } from '../../graphql/generated/resolvers.js'
import { rethrowResolverError } from '../../graphql/errors.js'
import { createPermissionGuard, type Permission } from '../admin/admin.authorization.js'
import type { AdminRepository } from '../admin/admin.repository.js'
import { createAdminBookService } from './admin-book.service.js'
import type { AdminBookRepository } from './admin-book.repository.js'

export function createAdminBookResolvers(
  repository: AdminBookRepository,
  adminRepository: AdminRepository,
): {
  Query: Pick<QueryResolvers<GraphQLContext>, 'adminBooks' | 'adminBook'>
  Mutation: Pick<
    MutationResolvers<GraphQLContext>,
    'createBook' | 'updateBook' | 'adjustBookStock' | 'setBookArchived'
  >
} {
  const guard = createPermissionGuard(adminRepository.getUserRole)
  const adminBookService = createAdminBookService(repository)
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
          adminBookService.list({
            search: args.search ?? '',
            filter: args.filter ?? 'ACTIVE',
            lowStockOnly: args.lowStockOnly ?? false,
            limit: args.limit ?? 20,
            offset: args.offset ?? 0,
          }),
        ),
      adminBook: (_, args, ctx) => run(ctx, () => adminBookService.get(args.id)),
    },
    Mutation: {
      createBook: (_, args, ctx) =>
        run(ctx, async (user) =>
          adminBookService.create(args.input, await adminRepository.getActivityActor(user.id)),
        ),
      updateBook: (_, args, ctx) =>
        run(ctx, async (user) =>
          adminBookService.update(
            args.id,
            args.input,
            await adminRepository.getActivityActor(user.id),
          ),
        ),
      adjustBookStock: (_, args, ctx) =>
        run(ctx, async (user) =>
          adminBookService.adjustStock(
            args.id,
            args.delta,
            await adminRepository.getActivityActor(user.id),
          ),
        ),
      setBookArchived: (_, args, ctx) =>
        run(
          ctx,
          async (user) =>
            adminBookService.archive(
              args.id,
              args.archived,
              await adminRepository.getActivityActor(user.id),
            ),
          'ARCHIVE_BOOKS',
        ),
    },
  }
}
