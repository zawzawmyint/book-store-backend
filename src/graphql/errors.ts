import { GraphQLError, type GraphQLFormattedError } from 'graphql'
import {
  ValidationError,
  CartConflictError,
  ConflictError,
  PaymentUnavailableError,
} from '../shared/errors.js'

const publicCodes = new Set([
  'BAD_USER_INPUT',
  'CONFLICT',
  'CART_CONFLICT',
  'PAYMENT_UNAVAILABLE',
  'FORBIDDEN',
  'UNAUTHENTICATED',
  'GRAPHQL_PARSE_FAILED',
  'GRAPHQL_VALIDATION_FAILED',
])

// Drivers can include SQL and bound values in exception messages. Apply this
// boundary to every resolver, including authorization and uncaught reads.
export function publicGraphQLError(error: GraphQLFormattedError): GraphQLFormattedError {
  const code =
    typeof error.extensions?.code === 'string' ? error.extensions.code : 'INTERNAL_SERVER_ERROR'
  const known = publicCodes.has(code)
  return {
    message: known ? error.message : 'Request unavailable. Please try again shortly.',
    locations: error.locations,
    path: error.path,
    extensions: { code: known ? code : 'INTERNAL_SERVER_ERROR' },
  }
}

export function rethrowResolverError(error: unknown): never {
  if (error instanceof CartConflictError)
    throw new GraphQLError(error.message, { extensions: { code: 'CART_CONFLICT' } })
  if (error instanceof PaymentUnavailableError)
    throw new GraphQLError(error.message, { extensions: { code: 'PAYMENT_UNAVAILABLE' } })
  if (error instanceof ConflictError)
    throw new GraphQLError(error.message, { extensions: { code: 'CONFLICT' } })
  if (error instanceof ValidationError) {
    throw new GraphQLError(error.message, { extensions: { code: 'BAD_USER_INPUT' } })
  }
  throw error
}
