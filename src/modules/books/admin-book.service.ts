import { validated } from '../../shared/validation.js'
import type { ActivityActor } from '../activity/activity.types.js'
import type { createAdminBookRepository } from './admin-book.repository.js'
import {
  adminBookIdSchema,
  adminBooksInputSchema,
  bookDetailsSchema,
  stockSchema,
  stockDeltaSchema,
} from './book.validation.js'

export function createAdminBookService(repository: ReturnType<typeof createAdminBookRepository>) {
  return {
    list: (input: unknown) => repository.list(validated(adminBooksInputSchema, input)),
    get: (id: string) => repository.get(validated(adminBookIdSchema, id)),
    create(input: { details: unknown; stock: number }, actor: ActivityActor) {
      return repository.create(
        validated(bookDetailsSchema, input.details),
        validated(stockSchema, input.stock),
        actor,
      )
    },
    update(id: string, details: unknown, actor: ActivityActor) {
      return repository.update(
        validated(adminBookIdSchema, id),
        validated(bookDetailsSchema, details),
        actor,
      )
    },
    adjustStock(id: string, delta: number, actor: ActivityActor) {
      return repository.adjustStock(
        validated(adminBookIdSchema, id),
        validated(stockDeltaSchema, delta),
        actor,
      )
    },
    archive(id: string, archived: boolean, actor: ActivityActor) {
      return repository.archive(validated(adminBookIdSchema, id), archived, actor)
    },
  }
}
