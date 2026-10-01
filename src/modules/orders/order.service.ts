import { ValidationError } from '../../shared/errors.js'
import type { OrderCustomer, OrderInput, OrderRepository } from './order.types.js'
import { orderInputSchema, orderPageSchema } from './order.validation.js'

export function createOrderService(repository: OrderRepository) {
  return {
    placeOrder(input: OrderInput, customer: OrderCustomer) {
      const result = orderInputSchema.safeParse(input)
      if (!result.success) throw new ValidationError(result.error.issues[0].message)
      return repository.saveOrder(customer, result.data.items)
    },
    myOrders(userId: string, limit: number, offset: number) {
      const result = orderPageSchema.safeParse({ limit, offset })
      if (!result.success) throw new ValidationError(result.error.issues[0].message)
      return repository.listOrders(userId, result.data.limit, result.data.offset)
    },
  }
}
