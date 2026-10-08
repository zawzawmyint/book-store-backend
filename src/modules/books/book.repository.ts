import { normalizeStore, type DatabaseInput } from '../../database/persistence.js'
import type { CatalogRepository } from './book.types.js'
export function createCatalogRepository(input: DatabaseInput): CatalogRepository {
  const store = normalizeStore(input)
  return {
    listGenres: () => store.genres(),
    listBooks: (search, limit, offset) => store.catalog(search, limit, offset),
    async getBook(id) {
      const row = await store.book(Number(id))
      return row && !row.archived ? row : null
    },
  }
}
