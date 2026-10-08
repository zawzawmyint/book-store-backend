import { numericLookupIdSchema, validated } from '../../shared/validation.js'
import type { CatalogRepository } from './book.types.js'
import { catalogInputSchema } from './book.validation.js'

export function createBookService(repository: CatalogRepository) {
  return {
    listGenres: repository.listGenres,
    listBooks(search = '', limit = 12, offset = 0) {
      const input = validated(catalogInputSchema, { search, limit, offset })
      return repository.listBooks(input.search, input.limit, input.offset)
    },
    async getBook(id: string) {
      const result = numericLookupIdSchema.safeParse(id)
      return result.success ? repository.getBook(result.data) : null
    },
  }
}
