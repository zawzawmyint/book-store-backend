import { numericIdSchema, validated } from '../../shared/validation.js'
import { adminOrderPageSchema, setOrderStatusSchema } from './order.validation.js'
import type { AdminOrderRepository } from './admin-order.repository.js'
import type { ActivityActor } from '../activity/activity.types.js'

export type AdminOrderListInput = {
  limit: number
  offset: number
  status?: string
  search?: string
}

export function createAdminOrderService(repository: AdminOrderRepository) {
  return {
    setStatus(input: unknown, actor: ActivityActor) {
      return repository.setStatus(validated(setOrderStatusSchema, input), actor)
    },
    list(input: AdminOrderListInput) {
      const page = validated(adminOrderPageSchema, input)
      return repository.list(page.limit, page.offset, page.status, page.search)
    },
    get(id: string) {
      return repository.get(validated(numericIdSchema, id))
    },
  }
}
