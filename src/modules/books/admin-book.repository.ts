import type Database from 'better-sqlite3'
import { and, count, eq, gte, lte, or, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { books } from '../../database/schema.js'
import { ValidationError } from '../../shared/errors.js'
import type { z } from 'zod'
import type { adminBooksInputSchema, bookDetailsSchema } from './book.validation.js'

export function createAdminBookRepository(db: Database.Database) {
  const orm = drizzle(db)
  const get = (id: string) =>
    orm
      .select()
      .from(books)
      .where(eq(books.id, Number(id)))
      .get() ?? null
  const saved = (row: typeof books.$inferSelect | undefined) => {
    if (!row) throw new ValidationError('Book was not found')
    return row
  }
  return {
    get,
    list(input: z.infer<typeof adminBooksInputSchema>) {
      const pattern = `%${input.search.replace(/[\\%_]/g, '\\$&')}%`
      const where = and(
        input.filter === 'ALL' ? undefined : eq(books.archived, input.filter === 'ARCHIVED'),
        input.lowStockOnly ? lte(books.stock, 5) : undefined,
        or(
          sql`${books.title} LIKE ${pattern} ESCAPE '\\'`,
          sql`${books.author} LIKE ${pattern} ESCAPE '\\'`,
          sql`${books.genre} LIKE ${pattern} ESCAPE '\\'`,
        ),
      )
      return {
        total: orm.select({ n: count() }).from(books).where(where).get()!.n,
        items: orm
          .select()
          .from(books)
          .where(where)
          .orderBy(books.id)
          .limit(input.limit)
          .offset(input.offset)
          .all(),
      }
    },
    create(details: z.infer<typeof bookDetailsSchema>, stock: number) {
      return saved(
        orm
          .insert(books)
          .values({ ...details, stock })
          .returning()
          .get(),
      )
    },
    update(id: string, details: z.infer<typeof bookDetailsSchema>) {
      return saved(
        orm
          .update(books)
          .set(details)
          .where(eq(books.id, Number(id)))
          .returning()
          .get(),
      )
    },
    adjustStock(id: string, delta: number) {
      const next = sql`${books.stock} + ${delta}`
      const row = orm
        .update(books)
        .set({ stock: next })
        .where(and(eq(books.id, Number(id)), gte(next, 0), lte(next, 1000000)))
        .returning()
        .get()
      if (!row)
        throw new ValidationError(
          'Book was not found or stock change would exceed available stock or limits',
        )
      return row
    },
    archive(id: string, archived: boolean) {
      return saved(
        orm
          .update(books)
          .set({ archived })
          .where(eq(books.id, Number(id)))
          .returning()
          .get(),
      )
    },
  }
}
