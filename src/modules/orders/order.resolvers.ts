import type Database from 'better-sqlite3'
import { GraphQLError } from 'graphql'
import type { MutationResolvers, QueryResolvers } from '../../graphql/generated/resolvers.js'
import type { GraphQLContext } from '../../graphql/context.js'
import { asGraphQLError } from '../../graphql/errors.js'
import { createOrderRepository } from './order.repository.js'
import { createOrderService } from './order.service.js'

function requireUser(context: GraphQLContext) {
  if (!context.user) {
    throw new GraphQLError('Sign in to continue', {
      extensions: { code: 'UNAUTHENTICATED' },
    })
  }
  return context.user
}

export function createOrderResolvers(db: Database.Database): {
  Query: Pick<QueryResolvers<GraphQLContext>, 'myOrders'>
  Mutation: Pick<MutationResolvers<GraphQLContext>, 'placeOrder'>
} {
  const service = createOrderService(createOrderRepository(db))
  return {
    Query: {
      myOrders: (_, args, context) => {
        const user = requireUser(context)
        try {
          return service.myOrders(user.id, args.limit ?? 20, args.offset ?? 0)
        } catch (error) {
          return asGraphQLError(error)
        }
      },
    },
    Mutation: {
      placeOrder: (_, args, context) => {
        const user = requireUser(context)
        try {
          return service.placeOrder(args.input, user)
        } catch (error) {
          return asGraphQLError(error)
        }
      },
    },
  }
}
