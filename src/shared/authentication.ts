import { GraphQLError } from 'graphql'
import type { AuthenticatedUser, GraphQLContext } from '../graphql/context.js'

export function requireUser(user: AuthenticatedUser | null): AuthenticatedUser {
  if (!user) {
    throw new GraphQLError('Sign in to continue', { extensions: { code: 'UNAUTHENTICATED' } })
  }
  return user
}

export function requireCartUser(context: GraphQLContext): AuthenticatedUser {
  const user = requireUser(context.user)
  if (context.expectedCartAccount !== undefined && context.expectedCartAccount !== user.id)
    throw new GraphQLError('Account changed. Sign in again to continue.', {
      extensions: { code: 'UNAUTHENTICATED' },
    })
  return user
}
