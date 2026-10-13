import type { QueryResolvers, MutationResolvers } from '../../graphql/generated/resolvers.js'
import type { GraphQLContext } from '../../graphql/context.js'
import { requireCartUser } from '../../shared/authentication.js'
import { rethrowResolverError } from '../../graphql/errors.js'
import { createCartService } from './cart.service.js'
import type { CartRepository } from './cart.repository.js'
export function createCartResolvers(repository: CartRepository): {
  Query: Pick<QueryResolvers<GraphQLContext>, 'myCart'>
  Mutation: Pick<MutationResolvers<GraphQLContext>, 'setCartItem' | 'mergeGuestCart'>
} {
  const service = createCartService(repository)
  return {
    Query: {
      myCart: async (_, _args, context) => {
        const user = requireCartUser(context)
        try {
          return await service.read(user.id)
        } catch (error) {
          return rethrowResolverError(error)
        }
      },
    },
    Mutation: {
      setCartItem: async (_, args, context) => {
        const user = requireCartUser(context)
        try {
          return await service.set(user.id, args.input)
        } catch (error) {
          return rethrowResolverError(error)
        }
      },
      mergeGuestCart: async (_, args, context) => {
        const user = requireCartUser(context)
        try {
          return await service.merge(user.id, args.input)
        } catch (error) {
          return rethrowResolverError(error)
        }
      },
    },
  }
}
