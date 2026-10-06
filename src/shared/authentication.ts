import { GraphQLError } from 'graphql'
import type { AuthenticatedUser } from '../graphql/context.js'

export function requireUser(user: AuthenticatedUser | null): AuthenticatedUser {
  if (!user) {
    throw new GraphQLError('Sign in to continue', { extensions: { code: 'UNAUTHENTICATED' } })
  }
  return user
}
