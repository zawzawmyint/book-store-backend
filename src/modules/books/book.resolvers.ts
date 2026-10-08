import type { QueryResolvers } from '../../graphql/generated/resolvers.js'
import { rethrowResolverError } from '../../graphql/errors.js'
import type { createCatalogRepository } from './book.repository.js'
import { createBookService } from './book.service.js'

export function createBookResolvers(
  repository: ReturnType<typeof createCatalogRepository>,
): QueryResolvers {
  const service = createBookService(repository)
  return {
    genres: () => service.listGenres(),
    books: async (_, args) => {
      try {
        return await service.listBooks(args.search ?? undefined, args.limit, args.offset)
      } catch (error) {
        return rethrowResolverError(error)
      }
    },
    book: (_, args) => service.getBook(args.id),
  }
}
