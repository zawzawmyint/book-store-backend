import type { MutationResolvers, QueryResolvers } from '../../graphql/generated/resolvers.js'
import { UserRole } from '../../graphql/generated/resolvers.js'
import type { AuthenticatedUser, GraphQLContext } from '../../graphql/context.js'
import { rethrowResolverError } from '../../graphql/errors.js'
import { validated } from '../../shared/validation.js'
import { createPermissionGuard } from './admin.authorization.js'
import type { createAdminRepository } from './admin.repository.js'
import { ValidationError } from '../../shared/errors.js'
import { adminUsersInputSchema, userPasswordSchema, userIdSchema } from './admin.validation.js'

export function createAdminResolvers(repository: ReturnType<typeof createAdminRepository>): {
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
  const permissions = createPermissionGuard(repository.getUserRole)
  const guard = (user: GraphQLContext['user']) => permissions(user, 'MANAGE_USERS')
  const run = async <T>(
    context: GraphQLContext,
    action: (user: AuthenticatedUser) => T,
  ): Promise<Awaited<T>> => {
    const user = await guard(context.user)
    try {
      return await action(user)
    } catch (error) {
      return rethrowResolverError(error)
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
    run(context, async (user) => {
      const userId = validated(userIdSchema, args.userId)
      await repository.setAdminAccess(
        userId,
        args.enabled,
        await repository.getActivityActor(user.id),
      )
      return await repository.getUser(userId)
    })
  const resetUserPassword = async (
    _: unknown,
    args: { userId: string; newPassword: string },
    context: GraphQLContext,
  ) => {
    const actor = await guard(context.user)
    try {
      const userId = validated(userIdSchema, args.userId)
      if (actor.id === userId) {
        throw new ValidationError('Change your own password from your profile.')
      }
      const newPassword = validated(userPasswordSchema, args.newPassword)
      await repository.resetUserPassword(
        userId,
        newPassword,
        await repository.getActivityActor(actor.id),
      )
      return await repository.getUser(userId)
    } catch (error) {
      return rethrowResolverError(error)
    }
  }
  return {
    Query: {
      viewer: async (_, _args, { user }) =>
        user ? { id: user.id, role: (await repository.getUserRole(user.id)) as UserRole } : null,
      adminUsers,
      adminUser,
      // Legacy fields share the canonical behavior and retain their schema types.
      adminCustomers: adminUsers,
      adminCustomer: adminUser,
    },
    Mutation: {
      setUserRole: (_, args, context) =>
        run(context, async (user) => {
          const userId = validated(userIdSchema, args.userId)
          await repository.setUserRole(
            userId,
            args.role,
            await repository.getActivityActor(user.id),
          )
          return await repository.getUser(userId)
        }),
      setUserAdminAccess,
      resetUserPassword,
      setCustomerAdminAccess: setUserAdminAccess,
      resetCustomerPassword: resetUserPassword,
    },
  }
}
