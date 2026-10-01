import { ValidationError } from '../../shared/errors.js'
import type { CatalogRepository } from './book.types.js'
import { catalogInputSchema } from './book.validation.js'

export function createBookService(repository: CatalogRepository) {
  return {
    listGenres: repository.listGenres,
    listBooks(search = '', limit = 12, offset = 0) {
      const result = catalogInputSchema.safeParse({ search, limit, offset })
      if (!result.success) {
        throw new ValidationError('Invalid search or page size')
      }
      return repository.listBooks(result.data.search, result.data.limit, result.data.offset)
    },
    getBook: repository.getBook,
  }
}
