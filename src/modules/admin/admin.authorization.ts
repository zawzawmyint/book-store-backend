import { GraphQLError } from 'graphql'
import type { AuthenticatedUser } from '../../graphql/context.js'

export function createAdminGuard(isAdmin: (id: string) => boolean) {
  return (user: AuthenticatedUser | null): void => {
    if (!user)
      throw new GraphQLError('Sign in to continue', { extensions: { code: 'UNAUTHENTICATED' } })
    if (!isAdmin(user.id))
      throw new GraphQLError('Admin access required', { extensions: { code: 'FORBIDDEN' } })
  }
}
