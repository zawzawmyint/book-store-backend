import type { QueryResolvers } from '../../graphql/generated/resolvers.js'
import { rethrowResolverError } from '../../graphql/errors.js'
import type { CatalogRepository } from './book.types.js'
import { createBookService } from './book.service.js'

export function createBookResolvers(repository: CatalogRepository): QueryResolvers {
  const bookService = createBookService(repository)
  return {
    genres: () => bookService.listGenres(),
    books: async (_, args) => {
      try {
        return await bookService.listBooks(args.search ?? undefined, args.limit, args.offset)
      } catch (error) {
        return rethrowResolverError(error)
      }
    },
    book: (_, args) => bookService.getBook(args.id),
  }
}
