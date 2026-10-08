import { normalizeStore, type DatabaseInput } from '../../database/persistence.js'
import type { BookRow } from '../../database/store.types.js'
import { ValidationError } from '../../shared/errors.js'
import type { z } from 'zod'
import type { adminBooksInputSchema, bookDetailsSchema } from './book.validation.js'
import type { ActivityActor, ActivityChange } from '../activity/activity.types.js'
import { insertActivity } from '../activity/activity.writer.js'
const fields = {
  title: 'TITLE',
  author: 'AUTHOR',
  genre: 'GENRE',
  description: 'DESCRIPTION',
  priceCents: 'PRICE_CENTS',
  stock: 'STOCK',
  archived: 'ARCHIVED',
} as const
function changesFor(before: BookRow | null, after: BookRow): ActivityChange[] {
  return (Object.keys(fields) as (keyof typeof fields)[]).flatMap((key) =>
    before && before[key] === after[key]
      ? []
      : [
          {
            field: fields[key],
            before: before ? String(before[key]) : null,
            after: String(after[key]),
          },
        ],
  )
}
function saved(row: BookRow | undefined) {
  if (!row) throw new ValidationError('Book was not found')
  return row
}
export function createAdminBookRepository(input: DatabaseInput) {
  const store = normalizeStore(input)
  return {
    async get(id: string) {
      return (await store.book(Number(id))) ?? null
    },
    list: (input: z.infer<typeof adminBooksInputSchema>) => store.adminBooks(input),
    create(details: z.infer<typeof bookDetailsSchema>, stock: number, actor: ActivityActor) {
      return store.transaction(async (tx) => {
        const row = await tx.createBook({ ...details, stock })
        await insertActivity(tx, actor, {
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
      return store.transaction(async (tx) => {
        const before = saved(await tx.book(Number(id))),
          row = saved(await tx.updateBook(Number(id), details)),
          changes = changesFor(before, row)
        if (changes.length)
          await insertActivity(tx, actor, {
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
      return store.transaction(async (tx) => {
        const before = saved(await tx.book(Number(id))),
          row = await tx.adjustStock(Number(id), delta)
        if (!row)
          throw new ValidationError(
            'Book was not found or stock change would exceed available stock or limits',
          )
        await insertActivity(tx, actor, {
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
      return store.transaction(async (tx) => {
        const before = saved(await tx.book(Number(id))),
          row = saved(await tx.updateBook(Number(id), { archived }))
        if (before.archived !== row.archived)
          await insertActivity(tx, actor, {
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
