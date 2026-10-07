import type { z } from 'zod'
import type { setOrderStatusSchema } from './order.validation.js'
import type { OrderStatus } from './order.types.js'
import type { ActivityActor } from '../activity/activity.types.js'
import { insertActivity } from '../activity/activity.writer.js'
import { ValidationError, ConflictError } from '../../shared/errors.js'
import type Database from 'better-sqlite3'
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import {
  orders,
  orderItems,
  orderStatusEvents,
  books,
  paymentOperations,
} from '../../database/schema.js'
import { orderPayment } from '../payments/payment.types.js'

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
      payment: orderPayment(row),
      items: lines
        .filter((line) => line.orderId === row.id)
        .map(({ title, quantity, unitPriceCents }) => ({ title, quantity, unitPriceCents })),
    }))
  }
  const history = (id: string) =>
    orm
      .select()
      .from(orderStatusEvents)
      .where(eq(orderStatusEvents.orderId, Number(id)))
      .orderBy(orderStatusEvents.id)
      .all()
      .map((row) => ({ ...row, id: String(row.id) }))
  const get = (id: string) =>
    withLines(
      orm
        .select()
        .from(orders)
        .where(eq(orders.id, Number(id)))
        .all(),
    )[0] ?? null
  return {
    history,
    get,
    setStatus(
      input: z.infer<typeof setOrderStatusSchema>,
      actor: ActivityActor,
      sessionClosed = false,
    ) {
      return orm.transaction(
        (tx) => {
          const before = tx
            .select()
            .from(orders)
            .where(eq(orders.id, Number(input.id)))
            .get()
          if (!before) throw new ValidationError('Order was not found')
          if (before.status === input.status) return get(input.id)!
          if (before.status !== input.expectedStatus)
            throw new ConflictError('Order status changed. Refresh the request and try again.')
          const allowed =
            before.status === 'SUBMITTED'
              ? ['ACCEPTED', 'CANCELLED']
              : before.status === 'ACCEPTED'
                ? ['COMPLETED', 'CANCELLED']
                : []
          if (!allowed.includes(input.status))
            throw new ValidationError('This order status transition is not allowed')
          if (
            before.paymentRequired &&
            input.status !== 'CANCELLED' &&
            (before.paymentStatus !== 'PAID' || before.cancellationIntent)
          )
            throw new ValidationError('Verified payment is required before processing this order')
          if (
            before.paymentRequired &&
            input.status === 'CANCELLED' &&
            before.paymentStatus === 'PENDING' &&
            !sessionClosed
          )
            throw new ValidationError('Pending payment session must be closed before cancellation')
          const update = tx
            .update(orders)
            .set({ status: input.status, cancellationIntent: null })
            .where(and(eq(orders.id, before.id), eq(orders.status, input.expectedStatus)))
            .run()
          if (update.changes !== 1) throw new ConflictError('Order status changed')
          if (input.status === 'CANCELLED') {
            const quantities = new Map<number, number>()
            for (const line of tx
              .select()
              .from(orderItems)
              .where(eq(orderItems.orderId, before.id))
              .all()) {
              if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 10)
                throw new ValidationError('Saved order quantity is outside supported limits')
              quantities.set(line.bookId, (quantities.get(line.bookId) ?? 0) + line.quantity)
            }
            for (const [bookId, quantity] of quantities) {
              const book = tx.select().from(books).where(eq(books.id, bookId)).get()
              if (
                !book ||
                !Number.isSafeInteger(book.stock) ||
                book.stock < 0 ||
                !Number.isSafeInteger(quantity) ||
                quantity > 1000000 ||
                book.stock + quantity > 1000000
              )
                throw new ValidationError(
                  'Saved inventory cannot be restored within supported limits',
                )
              const next = tx
                .update(books)
                .set({ stock: sql`${books.stock} + ${quantity}` })
                .where(eq(books.id, bookId))
                .returning()
                .get()!
              insertActivity(tx, actor, {
                action: 'BOOK_STOCK_ADJUSTED',
                targetType: 'BOOK',
                targetId: String(bookId),
                targetName: book.title,
                stockDelta: quantity,
                changes: [
                  { field: 'STOCK', before: String(book.stock), after: String(next.stock) },
                ],
              })
            }
          }
          if (actor.source === 'OPERATOR')
            throw new ValidationError('Order processing requires an account')
          tx.insert(orderStatusEvents)
            .values({
              orderId: before.id,
              fromStatus: before.status,
              toStatus: input.status,
              cancellationReason: input.cancellationReason ?? null,
              actorUserId: actor.userId,
              actorName: actor.name,
              actorRole: actor.role,
              actorType: actor.source === 'SYSTEM' ? 'SYSTEM' : 'USER',
            })
            .run()
          insertActivity(tx, actor, {
            action: 'ORDER_STATUS_CHANGED',
            targetType: 'ORDER',
            targetId: input.id,
            targetName: `Order request #${input.id}`,
            changes: [{ field: 'ORDER_STATUS', before: before.status, after: input.status }],
          })
          if (
            input.status === 'CANCELLED' &&
            before.paymentRequired &&
            before.paymentStatus === 'PAID'
          ) {
            tx.update(orders)
              .set({ paymentStatus: 'REFUND_PENDING' })
              .where(eq(orders.id, before.id))
              .run()
            tx.insert(paymentOperations)
              .values({
                id: `refund:${before.id}:1`,
                orderId: before.id,
                kind: 'REFUND',
                createdAt: Date.now(),
                retryAt: 0,
              })
              .onConflictDoNothing()
              .run()
            insertActivity(tx, actor, {
              action: 'ORDER_PAYMENT_CHANGED',
              targetType: 'ORDER',
              targetId: input.id,
              targetName: `Order request #${input.id}`,
              changes: [{ field: 'ORDER_PAYMENT_STATUS', before: 'PAID', after: 'REFUND_PENDING' }],
            })
          }
          return get(input.id)!
        },
        { behavior: 'immediate' },
      )
    },
    list(limit: number, offset: number, status: 'ALL' | OrderStatus = 'ALL') {
      const where = status === 'ALL' ? undefined : eq(orders.status, status)
      return {
        total: orm.select({ n: count() }).from(orders).where(where).get()!.n,
        items: withLines(
          orm
            .select()
            .from(orders)
            .where(where)
            .orderBy(desc(orders.createdAt), desc(orders.id))
            .limit(limit)
            .offset(offset)
            .all(),
        ),
      }
    },
  }
}
