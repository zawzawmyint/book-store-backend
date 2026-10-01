import type Database from 'better-sqlite3'
import type { QueryResolvers } from '../../graphql/generated/resolvers.js'
import { asGraphQLError } from '../../graphql/errors.js'
import { createCatalogRepository } from './book.repository.js'
import { createBookService } from './book.service.js'

export function createBookResolvers(db: Database.Database): QueryResolvers {
  const service = createBookService(createCatalogRepository(db))
  return {
    genres: () => service.listGenres(),
    books: (_, args) => {
      try {
        return service.listBooks(args.search ?? undefined, args.limit, args.offset)
      } catch (error) {
        return asGraphQLError(error)
      }
    },
    book: (_, args) => service.getBook(args.id),
  }
}
