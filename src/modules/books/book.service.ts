import { numericLookupIdSchema, validated } from '../../shared/validation.js'
import type { CatalogRepository, CatalogOptions } from './book.types.js'
import { catalogInputSchema } from './book.validation.js'

export function createBookService(repository: CatalogRepository) {
  return {
    listGenres: repository.listGenres,
    listBooks(
      search: string | null = '',
      limit: number | null = 12,
      offset: number | null = 0,
      options?: CatalogOptions,
    ) {
      const input = validated(catalogInputSchema, {
        search: search ?? '',
        limit: limit ?? 12,
        offset: offset ?? 0,
        genre: options?.genre ?? '',
        inStockOnly: options?.inStockOnly ?? false,
        sort: options?.sort ?? 'DEFAULT',
        minPriceCents: options?.minPriceCents ?? undefined,
        maxPriceCents: options?.maxPriceCents ?? undefined,
      })
      if (options === undefined)
        return repository.listBooks(input.search, input.limit, input.offset)
      const { search: term, limit: size, offset: start, ...selection } = input
      return repository.listBooks(term, size, start, selection)
    },
    async getBook(id: string) {
      const result = numericLookupIdSchema.safeParse(id)
      return result.success ? repository.getBook(result.data) : null
    },
  }
}
