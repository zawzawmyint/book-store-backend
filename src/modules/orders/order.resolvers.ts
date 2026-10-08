import type {
  MyOrder,
  MyOrdersPage,
  OrderReceipt,
  CheckoutResult,
} from '../../graphql/generated/resolvers.js'
import type { MutationResolvers, QueryResolvers } from '../../graphql/generated/resolvers.js'
import type { GraphQLContext } from '../../graphql/context.js'
import { rethrowResolverError } from '../../graphql/errors.js'
import type { createOrderRepository } from './order.repository.js'
import { createOrderService } from './order.service.js'
import type { createPaymentService } from '../payments/payment.service.js'
import { createPermissionGuard } from '../admin/admin.authorization.js'
import type { createAdminRepository } from '../admin/admin.repository.js'
import { requireUser } from '../../shared/authentication.js'

export function createOrderResolvers(
  repository: ReturnType<typeof createOrderRepository>,
  roles: ReturnType<typeof createAdminRepository>,
  payments: ReturnType<typeof createPaymentService>,
): {
  Query: Pick<
    QueryResolvers<GraphQLContext>,
    'myOrders' | 'myOrder' | 'deliveryOptions' | 'quoteCheckout'
  >
  Mutation: Pick<
    MutationResolvers<GraphQLContext>,
    | 'placeOrder'
    | 'setOrderStatus'
    | 'createCheckout'
    | 'resumeCheckout'
    | 'refreshOrderPayment'
    | 'retryOrderRefund'
  >
} {
  const service = createOrderService(repository)
  const guard = createPermissionGuard(roles.getUserRole)
  return {
    Query: {
      deliveryOptions: (_, _args, context) => {
        requireUser(context.user)
        try {
          return payments.deliveryOptions()
        } catch (error) {
          return rethrowResolverError(error)
        }
      },
      quoteCheckout: async (_, args, context) => {
        requireUser(context.user)
        try {
          return await payments.quoteCheckout(args.input)
        } catch (error) {
          return rethrowResolverError(error)
        }
      },
      myOrder: async (_, args, context) => {
        const user = requireUser(context.user)
        try {
          return (await service.myOrder(user.id, args.id)) as MyOrder | null
        } catch (error) {
          return rethrowResolverError(error)
        }
      },
      myOrders: async (_, args, context) => {
        const user = requireUser(context.user)
        try {
          return (await service.myOrders(
            user.id,
            args.limit ?? 20,
            args.offset ?? 0,
          )) as MyOrdersPage
        } catch (error) {
          return rethrowResolverError(error)
        }
      },
    },
    Mutation: {
      setOrderStatus: async (_, args, context) => {
        const user = await guard(context.user, 'PROCESS_ORDERS')
        try {
          return await payments.setOrderStatus(args.input, {
            source: 'GRAPHQL',
            userId: user.id,
            name: user.name,
            role: await roles.getUserRole(user.id),
          })
        } catch (error) {
          return rethrowResolverError(error)
        }
      },
      createCheckout: async (_, args, context) => {
        const user = requireUser(context.user)
        try {
          return (await payments.createCheckout(args.input, user)) as CheckoutResult
        } catch (error) {
          return rethrowResolverError(error)
        }
      },
      resumeCheckout: async (_, args, context) => {
        const user = requireUser(context.user)
        try {
          return (await payments.resumeCheckout(args.orderId, user)) as CheckoutResult
        } catch (error) {
          return rethrowResolverError(error)
        }
      },
      refreshOrderPayment: async (_, args, context) => {
        const user = requireUser(context.user)
        try {
          return (await payments.refreshOrderPayment(args.orderId, user)) as MyOrder
        } catch (error) {
          return rethrowResolverError(error)
        }
      },
      retryOrderRefund: async (_, args, context) => {
        await guard(context.user, 'PROCESS_ORDERS')
        try {
          return await payments.retryOrderRefund(args.orderId)
        } catch (error) {
          return rethrowResolverError(error)
        }
      },
      placeOrder: async (_, args, context) => {
        const user = requireUser(context.user)
        try {
          return service.placeOrder(args.input, user) as OrderReceipt
        } catch (error) {
          return rethrowResolverError(error)
        }
      },
    },
  }
}
