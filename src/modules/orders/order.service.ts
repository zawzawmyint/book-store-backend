import { ValidationError } from '../../shared/errors.js'
import type { createOrderRepository } from './order.repository.js'
import type { OrderInput } from './order.types.js'

const invalid = (message: string) => new ValidationError(message)

export function createOrderService(repository: ReturnType<typeof createOrderRepository>) {
  return {
    placeOrder(input: OrderInput) {
      const name = input.customerName.trim()
      const email = input.email.trim().toLowerCase()
      if (!name || name.length > 120) throw invalid('Enter a name of up to 120 characters')
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw invalid('Enter a valid email address')
      if (input.items.length < 1 || input.items.length > 20)
        throw invalid('Order must contain 1 to 20 books')
      if (new Set(input.items.map((item) => item.bookId)).size !== input.items.length)
        throw invalid('Each book can appear only once')
      for (const item of input.items) {
        if (
          !/^\d+$/.test(item.bookId) ||
          !Number.isInteger(item.quantity) ||
          item.quantity < 1 ||
          item.quantity > 10
        ) {
          throw invalid('Each quantity must be between 1 and 10')
        }
      }

      return repository.saveOrder(name, email, input.items)
    },
  }
}
