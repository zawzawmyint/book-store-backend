import type Database from 'better-sqlite3'
import { and, count, eq, gte, lte, or, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { books } from '../../database/schema.js'
import { ValidationError } from '../../shared/errors.js'
import type { z } from 'zod'
import type { adminBooksInputSchema, bookDetailsSchema } from './book.validation.js'
import type { ActivityActor, ActivityChange } from '../activity/activity.types.js'
import { insertActivity } from '../activity/activity.writer.js'

const bookFields = {
  title: 'TITLE',
  author: 'AUTHOR',
  genre: 'GENRE',
  description: 'DESCRIPTION',
  priceCents: 'PRICE_CENTS',
  stock: 'STOCK',
  archived: 'ARCHIVED',
} as const
function changesFor(
  before: typeof books.$inferSelect | null,
  after: typeof books.$inferSelect,
): ActivityChange[] {
  return (Object.keys(bookFields) as (keyof typeof bookFields)[]).flatMap((key) =>
    before && before[key] === after[key]
      ? []
      : [
          {
            field: bookFields[key],
            before: before ? String(before[key]) : null,
            after: String(after[key]),
          },
        ],
  )
}

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
    create(details: z.infer<typeof bookDetailsSchema>, stock: number, actor: ActivityActor) {
      return orm.transaction((tx) => {
        const row = saved(
          tx
            .insert(books)
            .values({ ...details, stock })
            .returning()
            .get(),
        )
        insertActivity(tx, actor, {
          action: 'BOOK_CREATED',
          targetType: 'BOOK',
          targetId: String(row.id),
          targetName: row.title,
          changes: changesFor(null, row),
        })
        return row
      })
    },
    update(id: string, details: z.infer<typeof bookDetailsSchema>, actor: ActivityActor) {
      return orm.transaction((tx) => {
        const before = saved(
          tx
            .select()
            .from(books)
            .where(eq(books.id, Number(id)))
            .get(),
        )
        const row = saved(
          tx
            .update(books)
            .set(details)
            .where(eq(books.id, Number(id)))
            .returning()
            .get(),
        )
        const changes = changesFor(before, row)
        if (changes.length)
          insertActivity(tx, actor, {
            action: 'BOOK_UPDATED',
            targetType: 'BOOK',
            targetId: id,
            targetName: row.title,
            changes,
          })
        return row
      })
    },
    adjustStock(id: string, delta: number, actor: ActivityActor) {
      return orm.transaction((tx) => {
        const before = saved(
          tx
            .select()
            .from(books)
            .where(eq(books.id, Number(id)))
            .get(),
        )
        const next = sql`${books.stock} + ${delta}`
        const row = tx
          .update(books)
          .set({ stock: next })
          .where(and(eq(books.id, Number(id)), gte(next, 0), lte(next, 1000000)))
          .returning()
          .get()
        if (!row)
          throw new ValidationError(
            'Book was not found or stock change would exceed available stock or limits',
          )
        insertActivity(tx, actor, {
          action: 'BOOK_STOCK_ADJUSTED',
          targetType: 'BOOK',
          targetId: id,
          targetName: row.title,
          changes: changesFor(before, row),
          stockDelta: delta,
        })
        return row
      })
    },
    archive(id: string, archived: boolean, actor: ActivityActor) {
      return orm.transaction((tx) => {
        const before = saved(
          tx
            .select()
            .from(books)
            .where(eq(books.id, Number(id)))
            .get(),
        )
        const row = saved(
          tx
            .update(books)
            .set({ archived })
            .where(eq(books.id, Number(id)))
            .returning()
            .get(),
        )
        if (before.archived !== row.archived)
          insertActivity(tx, actor, {
            action: archived ? 'BOOK_ARCHIVED' : 'BOOK_RESTORED',
            targetType: 'BOOK',
            targetId: id,
            targetName: row.title,
            changes: changesFor(before, row),
          })
        return row
      })
    },
  }
}
