import { numericIdSchema, validated } from '../../shared/validation.js'
import { orderPageSchema } from './order.validation.js'
import type { createAdminOrderRepository } from './admin-order.repository.js'

export function createAdminOrderService(repository: ReturnType<typeof createAdminOrderRepository>) {
  return {
    list(limit: number, offset: number) {
      const page = validated(orderPageSchema, { limit, offset })
      return repository.list(page.limit, page.offset)
    },
    get(id: string) {
      return repository.get(validated(numericIdSchema, id))
    },
  }
}
