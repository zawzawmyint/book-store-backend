import { GraphQLError } from 'graphql'
import { ValidationError, ConflictError } from '../shared/errors.js'

export function rethrowResolverError(error: unknown): never {
  if (error instanceof ConflictError)
    throw new GraphQLError(error.message, { extensions: { code: 'CONFLICT' } })
  if (error instanceof ValidationError) {
    throw new GraphQLError(error.message, { extensions: { code: 'BAD_USER_INPUT' } })
  }
  throw error
}
