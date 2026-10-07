import { GraphQLError } from 'graphql'
import { ValidationError, ConflictError, PaymentUnavailableError } from '../shared/errors.js'

export function rethrowResolverError(error: unknown): never {
  if (error instanceof PaymentUnavailableError)
    throw new GraphQLError(error.message, { extensions: { code: 'PAYMENT_UNAVAILABLE' } })
  if (error instanceof ConflictError)
    throw new GraphQLError(error.message, { extensions: { code: 'CONFLICT' } })
  if (error instanceof ValidationError) {
    throw new GraphQLError(error.message, { extensions: { code: 'BAD_USER_INPUT' } })
  }
  throw error
}
