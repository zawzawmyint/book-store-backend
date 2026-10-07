import { validated, numericIdSchema } from '../../shared/validation.js'
import type { OrderCustomer, OrderInput, OrderRepository } from './order.types.js'
import { orderInputSchema, orderPageSchema } from './order.validation.js'

export function createOrderService(repository: OrderRepository) {
  return {
    myOrder(userId: string, id: string) {
      return repository.getOrder(userId, validated(numericIdSchema, id))
    },
    placeOrder(input: OrderInput, customer: OrderCustomer) {
      const order = validated(orderInputSchema, input)
      return repository.saveOrder(customer, order.items)
    },
    myOrders(userId: string, limit: number, offset: number) {
      const page = validated(orderPageSchema, { limit, offset })
      return repository.listOrders(userId, page.limit, page.offset)
    },
  }
}
