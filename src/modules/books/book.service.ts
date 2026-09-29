import { ValidationError } from '../../shared/errors.js'
import type { createCatalogRepository } from './book.repository.js'

export function createBookService(repository: ReturnType<typeof createCatalogRepository>) {
  return {
    listBooks(search = '', limit = 12, offset = 0) {
      const term = search.trim()
      if (
        term.length > 100 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 24 ||
        !Number.isInteger(offset) ||
        offset < 0
      ) {
        throw new ValidationError('Invalid search or page size')
      }
      return repository.listBooks(term, limit, offset)
    },
    getBook: repository.getBook,
  }
}
