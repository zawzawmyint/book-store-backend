import type {
  MyOrder,
  MyOrdersPage,
  OrderReceipt,
  CheckoutResult,
} from '../../graphql/generated/resolvers.js'
import type { MutationResolvers, QueryResolvers } from '../../graphql/generated/resolvers.js'
import type { GraphQLContext } from '../../graphql/context.js'
import { rethrowResolverError } from '../../graphql/errors.js'
import type { OrderRepository } from './order.types.js'
import { createOrderService } from './order.service.js'
import type { PaymentService } from '../payments/payment.service.js'
import { createPermissionGuard } from '../admin/admin.authorization.js'
import type { AdminRepository } from '../admin/admin.repository.js'
import { requireUser, requireCartUser } from '../../shared/authentication.js'

export function createOrderResolvers(
  repository: OrderRepository,
  adminRepository: AdminRepository,
  paymentService: PaymentService,
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
  const orderService = createOrderService(repository)
  const guard = createPermissionGuard(adminRepository.getUserRole)
  return {
    Query: {
      deliveryOptions: (_, _args, context) => {
        requireUser(context.user)
        try {
          return paymentService.deliveryOptions()
        } catch (error) {
          return rethrowResolverError(error)
        }
      },
      quoteCheckout: async (_, args, context) => {
        requireUser(context.user)
        try {
          return await paymentService.quoteCheckout(args.input)
        } catch (error) {
          return rethrowResolverError(error)
        }
      },
      myOrder: async (_, args, context) => {
        const user = requireUser(context.user)
        try {
          return (await orderService.myOrder(user.id, args.id)) as MyOrder | null
        } catch (error) {
          return rethrowResolverError(error)
        }
      },
      myOrders: async (_, args, context) => {
        const user = requireUser(context.user)
        try {
          return (await orderService.myOrders(
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
          return await paymentService.setOrderStatus(args.input, {
            source: 'GRAPHQL',
            userId: user.id,
            name: user.name,
            role: await adminRepository.getUserRole(user.id),
          })
        } catch (error) {
          return rethrowResolverError(error)
        }
      },
      createCheckout: async (_, args, context) => {
        const user = requireCartUser(context)
        try {
          return (await paymentService.createCheckout(args.input, user)) as CheckoutResult
        } catch (error) {
          return rethrowResolverError(error)
        }
      },
      resumeCheckout: async (_, args, context) => {
        const user = requireCartUser(context)
        try {
          return (await paymentService.resumeCheckout(args.orderId, user)) as CheckoutResult
        } catch (error) {
          return rethrowResolverError(error)
        }
      },
      refreshOrderPayment: async (_, args, context) => {
        const user = requireCartUser(context)
        try {
          return (await paymentService.refreshOrderPayment(args.orderId, user)) as MyOrder
        } catch (error) {
          return rethrowResolverError(error)
        }
      },
      retryOrderRefund: async (_, args, context) => {
        await guard(context.user, 'PROCESS_ORDERS')
        try {
          return await paymentService.retryOrderRefund(args.orderId)
        } catch (error) {
          return rethrowResolverError(error)
        }
      },
      placeOrder: async (_, args, context) => {
        const user = requireUser(context.user)
        try {
          return orderService.placeOrder(args.input, user) as OrderReceipt
        } catch (error) {
          return rethrowResolverError(error)
        }
      },
    },
  }
}
