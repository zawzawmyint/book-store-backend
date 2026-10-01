import { validated } from '../../shared/validation.js'
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
    create(input: { details: unknown; stock: number }) {
      return repository.create(
        validated(bookDetailsSchema, input.details),
        validated(stockSchema, input.stock),
      )
    },
    update(id: string, details: unknown) {
      return repository.update(
        validated(adminBookIdSchema, id),
        validated(bookDetailsSchema, details),
      )
    },
    adjustStock(id: string, delta: number) {
      return repository.adjustStock(
        validated(adminBookIdSchema, id),
        validated(stockDeltaSchema, delta),
      )
    },
    archive(id: string, archived: boolean) {
      return repository.archive(validated(adminBookIdSchema, id), archived)
    },
  }
}
