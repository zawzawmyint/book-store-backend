import type Database from 'better-sqlite3'
import type { MutationResolvers, QueryResolvers } from '../../graphql/generated/resolvers.js'
import { UserRole } from '../../graphql/generated/resolvers.js'
import type { AuthenticatedUser, GraphQLContext } from '../../graphql/context.js'
import { asGraphQLError } from '../../graphql/errors.js'
import { validated } from '../../shared/validation.js'
import { createPermissionGuard } from './admin.authorization.js'
import { createAdminRepository } from './admin.repository.js'
import { ValidationError } from '../../shared/errors.js'
import { adminUsersInputSchema, userPasswordSchema, userIdSchema } from './admin.validation.js'

export function createAdminResolvers(db: Database.Database): {
  Query: Pick<
    QueryResolvers<GraphQLContext>,
    'viewer' | 'adminUsers' | 'adminUser' | 'adminCustomers' | 'adminCustomer'
  >
  Mutation: Pick<
    MutationResolvers<GraphQLContext>,
    | 'setUserRole'
    | 'setUserAdminAccess'
    | 'resetUserPassword'
    | 'setCustomerAdminAccess'
    | 'resetCustomerPassword'
  >
} {
  const repository = createAdminRepository(db)
  const permissions = createPermissionGuard(repository.getUserRole)
  const guard = (user: GraphQLContext['user']) => permissions(user, 'MANAGE_USERS')
  const run = <T>(context: GraphQLContext, action: (user: AuthenticatedUser) => T): T => {
    const user = guard(context.user)
    try {
      return action(user)
    } catch (error) {
      return asGraphQLError(error)
    }
  }
  const adminUsers = (
    _: unknown,
    args: {
      search?: string | null
      role?: 'ALL' | 'CUSTOMER' | 'STAFF' | 'ADMIN' | null
      limit?: number | null
      offset?: number | null
    },
    context: GraphQLContext,
  ) =>
    run(context, () =>
      repository.listUsers(
        validated(adminUsersInputSchema, {
          search: args.search ?? '',
          role: args.role ?? 'ALL',
          limit: args.limit ?? 20,
          offset: args.offset ?? 0,
        }),
      ),
    )
  const adminUser = (_: unknown, args: { id: string }, context: GraphQLContext) =>
    run(context, () => repository.getUser(validated(userIdSchema, args.id)))
  const setUserAdminAccess = (
    _: unknown,
    args: { userId: string; enabled: boolean },
    context: GraphQLContext,
  ) =>
    run(context, (user) => {
      const userId = validated(userIdSchema, args.userId)
      repository.setAdminAccess(userId, args.enabled, repository.getActivityActor(user.id))
      return repository.getUser(userId)
    })
  const resetUserPassword = async (
    _: unknown,
    args: { userId: string; newPassword: string },
    context: GraphQLContext,
  ) => {
    const actor = guard(context.user)
    try {
      const userId = validated(userIdSchema, args.userId)
      if (actor.id === userId) {
        throw new ValidationError('Change your own password from your profile.')
      }
      const newPassword = validated(userPasswordSchema, args.newPassword)
      await repository.resetUserPassword(userId, newPassword, repository.getActivityActor(actor.id))
      return repository.getUser(userId)
    } catch (error) {
      return asGraphQLError(error)
    }
  }
  return {
    Query: {
      viewer: (_, _args, { user }) =>
        user ? { id: user.id, role: repository.getUserRole(user.id) as UserRole } : null,
      adminUsers,
      adminUser,
      // Legacy fields share the canonical behavior and retain their schema types.
      adminCustomers: adminUsers,
      adminCustomer: adminUser,
    },
    Mutation: {
      setUserRole: (_, args, context) =>
        run(context, (user) => {
          const userId = validated(userIdSchema, args.userId)
          repository.setUserRole(userId, args.role, repository.getActivityActor(user.id))
          return repository.getUser(userId)
        }),
      setUserAdminAccess,
      resetUserPassword,
      setCustomerAdminAccess: setUserAdminAccess,
      resetCustomerPassword: resetUserPassword,
    },
  }
}
