import { GraphQLError } from 'graphql'
import { ValidationError } from '../shared/errors.js'

export function asGraphQLError(error: unknown): never {
  if (error instanceof ValidationError) {
    throw new GraphQLError(error.message, { extensions: { code: 'BAD_USER_INPUT' } })
  }
  throw error
}
