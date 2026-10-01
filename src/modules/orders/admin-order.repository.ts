import type Database from 'better-sqlite3'
import { count, desc, eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { orders, orderItems } from '../../database/schema.js'

export function createAdminOrderRepository(db: Database.Database) {
  const orm = drizzle(db)
  function withLines(rows: (typeof orders.$inferSelect)[]) {
    const lines = rows.length
      ? orm
          .select()
          .from(orderItems)
          .where(
            inArray(
              orderItems.orderId,
              rows.map((row) => row.id),
            ),
          )
          .orderBy(orderItems.id)
          .all()
      : []
    return rows.map((row) => ({
      ...row,
      id: String(row.id),
      items: lines
        .filter((line) => line.orderId === row.id)
        .map(({ title, quantity, unitPriceCents }) => ({ title, quantity, unitPriceCents })),
    }))
  }
  return {
    list(limit: number, offset: number) {
      return {
        total: orm.select({ n: count() }).from(orders).get()!.n,
        items: withLines(
          orm
            .select()
            .from(orders)
            .orderBy(desc(orders.createdAt), desc(orders.id))
            .limit(limit)
            .offset(offset)
            .all(),
        ),
      }
    },
    get(id: string) {
      return (
        withLines(
          orm
            .select()
            .from(orders)
            .where(eq(orders.id, Number(id)))
            .all(),
        )[0] ?? null
      )
    },
  }
}
