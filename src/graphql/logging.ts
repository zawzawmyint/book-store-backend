import type { ApolloServerPlugin } from '@apollo/server'
import type { GraphQLContext } from './context.js'
import { log } from '../shared/logger.js'

const expectedCodes = new Set([
  'BAD_USER_INPUT',
  'NOTIFICATIONS_DISABLED',
  'CONFLICT',
  'CART_CONFLICT',
  'PAYMENT_UNAVAILABLE',
  'FORBIDDEN',
  'UNAUTHENTICATED',
  'GRAPHQL_PARSE_FAILED',
  'GRAPHQL_VALIDATION_FAILED',
  'OPERATION_RESOLUTION_FAILURE',
  'BAD_REQUEST',
  'PERSISTED_QUERY_NOT_FOUND',
  'PERSISTED_QUERY_NOT_SUPPORTED',
])
export const operationalLoggingPlugin: ApolloServerPlugin<GraphQLContext> = {
  async requestDidStart() {
    const started = performance.now()
    return {
      async willSendResponse({ errors, operationName }) {
        const common = {
          component: 'graphql' as const,
          operationName: operationName ?? undefined,
          durationMs: Math.round(performance.now() - started),
        }
        if (!errors?.length) {
          log('info', 'graphql.completed', common)
          return
        }
        const codes = new Set(
          errors.map((error) => {
            const code = error.extensions?.code
            return typeof code === 'string' && expectedCodes.has(code)
              ? code
              : 'INTERNAL_SERVER_ERROR'
          }),
        )
        for (const errorCode of codes)
          log(errorCode === 'INTERNAL_SERVER_ERROR' ? 'error' : 'warn', 'graphql.failed', {
            ...common,
            errorCode,
          })
      },
    }
  },
  async contextCreationDidFail() {
    log('error', 'graphql.context_failed', {
      component: 'graphql',
      errorCode: 'INTERNAL_SERVER_ERROR',
    })
  },
  async unexpectedErrorProcessingRequest() {
    log('error', 'graphql.processing_failed', {
      component: 'graphql',
      errorCode: 'INTERNAL_SERVER_ERROR',
    })
  },
}
