import { validated, numericIdSchema } from '../../shared/validation.js'
import type { OrderCustomer, OrderInput, OrderRepository } from './order.types.js'
import { orderPageSchema } from './order.validation.js'
import { ValidationError } from '../../shared/errors.js'

export function createOrderService(repository: OrderRepository) {
  return {
    myOrder(userId: string, id: string) {
      return repository.getOrderForUser(userId, validated(numericIdSchema, id))
    },
    placeOrder(_input: OrderInput, _customer: OrderCustomer) {
      throw new ValidationError('Use createCheckout to place a paid order')
    },
    myOrders(userId: string, limit: number, offset: number) {
      const page = validated(orderPageSchema, { limit, offset })
      return repository.listOrders(userId, page.limit, page.offset)
    },
  }
}
