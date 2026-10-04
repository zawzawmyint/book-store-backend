import type Database from 'better-sqlite3'
import type { MutationResolvers, QueryResolvers } from '../../graphql/generated/resolvers.js'
import { UserRole } from '../../graphql/generated/resolvers.js'
import type { GraphQLContext } from '../../graphql/context.js'
import { asGraphQLError } from '../../graphql/errors.js'
import { validated } from '../../shared/validation.js'
import { createAdminGuard } from './admin.authorization.js'
import { createAdminRepository } from './admin.repository.js'
import { ValidationError } from '../../shared/errors.js'
import {
  adminCustomersInputSchema,
  customerPasswordSchema,
  customerUserIdSchema,
} from './admin.validation.js'

export function createAdminResolvers(db: Database.Database): {
  Query: Pick<QueryResolvers<GraphQLContext>, 'viewer' | 'adminCustomers' | 'adminCustomer'>
  Mutation: Pick<MutationResolvers<GraphQLContext>, 'setCustomerAdminAccess' | 'resetCustomerPassword'>
} {
  const repository = createAdminRepository(db)
  const guard = createAdminGuard(repository.isAdmin)
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
      viewer: (_, _args, { user }) =>
        user
          ? { id: user.id, role: repository.isAdmin(user.id) ? UserRole.Admin : UserRole.Customer }
          : null,
      adminCustomers: (_, args, context) =>
        run(context, () =>
          repository.listCustomers(
            validated(adminCustomersInputSchema, {
              search: args.search ?? '',
              role: args.role ?? 'ALL',
              limit: args.limit ?? 20,
              offset: args.offset ?? 0,
            }),
          ),
        ),
      adminCustomer: (_, args, context) =>
        run(context, () => repository.getCustomer(validated(customerUserIdSchema, args.id))),
    },
    Mutation: {
      setCustomerAdminAccess: (_, args, context) =>
        run(context, () => {
          const userId = validated(customerUserIdSchema, args.userId)
          repository.setAdminAccess(userId, args.enabled)
          return repository.getCustomer(userId)
        }),
      resetCustomerPassword: async (_, args, context) => {
        const actor = context.user
        guard(actor)
        try {
          const userId = validated(customerUserIdSchema, args.userId)
          if (actor?.id === userId) {
            throw new ValidationError('Change your own password from your profile.')
          }
          const newPassword = validated(customerPasswordSchema, args.newPassword)
          await repository.resetCustomerPassword(userId, newPassword)
          return repository.getCustomer(userId)
        } catch (error) {
          return asGraphQLError(error)
        }
      },
    },
  }
}
