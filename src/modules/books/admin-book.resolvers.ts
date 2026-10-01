import type Database from 'better-sqlite3'
import type { GraphQLContext } from '../../graphql/context.js'
import type { QueryResolvers, MutationResolvers } from '../../graphql/generated/resolvers.js'
import { asGraphQLError } from '../../graphql/errors.js'
import { createAdminGuard } from '../admin/admin.authorization.js'
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
  const guard = createAdminGuard(createAdminRepository(db).isAdmin)
  const service = createAdminBookService(createAdminBookRepository(db))
  const run = <T>(context: GraphQLContext, action: () => T): T => {
    guard(context.user)
    try {
      return action()
    } catch (error) {
      return asGraphQLError(error)
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
      createBook: (_, args, ctx) => run(ctx, () => service.create(args.input)),
      updateBook: (_, args, ctx) => run(ctx, () => service.update(args.id, args.input)),
      adjustBookStock: (_, args, ctx) => run(ctx, () => service.adjustStock(args.id, args.delta)),
      setBookArchived: (_, args, ctx) => run(ctx, () => service.archive(args.id, args.archived)),
    },
  }
}
