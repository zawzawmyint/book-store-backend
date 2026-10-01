import type Database from 'better-sqlite3'
import { and, count, eq, or, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { books } from '../../database/schema.js'
import type { CatalogRepository } from './book.types.js'

export function createCatalogRepository(db: Database.Database): CatalogRepository {
  const orm = drizzle(db)
  return {
    listGenres() {
      return orm
        .selectDistinct({ genre: books.genre })
        .from(books)
        .where(eq(books.archived, false))
        .orderBy(books.genre)
        .all()
        .map((row) => row.genre)
    },
    listBooks(search: string, limit: number, offset: number) {
      const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`
      const where = and(
        eq(books.archived, false),
        or(
          sql`${books.title} LIKE ${pattern} ESCAPE '\\'`,
          sql`${books.author} LIKE ${pattern} ESCAPE '\\'`,
          sql`${books.genre} LIKE ${pattern} ESCAPE '\\'`,
        ),
      )
      const total = orm.select({ count: count() }).from(books).where(where).get()!.count
      const items = orm
        .select()
        .from(books)
        .where(where)
        .orderBy(books.id)
        .limit(limit)
        .offset(offset)
        .all()
      return { total, items }
    },
    getBook(id: string) {
      if (!/^\d+$/.test(id)) return null
      return (
        orm
          .select()
          .from(books)
          .where(and(eq(books.id, Number(id)), eq(books.archived, false)))
          .get() ?? null
      )
    },
  }
}
