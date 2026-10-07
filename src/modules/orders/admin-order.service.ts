import { numericIdSchema, validated } from '../../shared/validation.js'
import { adminOrderPageSchema, setOrderStatusSchema } from './order.validation.js'
import type { createAdminOrderRepository } from './admin-order.repository.js'

export function createAdminOrderService(repository: ReturnType<typeof createAdminOrderRepository>) {
  return {
    setStatus(input: unknown, actor: import('../activity/activity.types.js').ActivityActor) {
      return repository.setStatus(validated(setOrderStatusSchema, input), actor)
    },
    list(limit: number, offset: number, status: string = 'ALL') {
      const page = validated(adminOrderPageSchema, { limit, offset, status })
      return repository.list(page.limit, page.offset, page.status)
    },
    get(id: string) {
      return repository.get(validated(numericIdSchema, id))
    },
  }
}
