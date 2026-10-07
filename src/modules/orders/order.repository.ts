import type Database from 'better-sqlite3'
import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { books, orders, orderItems, orderStatusEvents, userRoles } from '../../database/schema.js'
import { ValidationError } from '../../shared/errors.js'
import type { OrderRepository } from './order.types.js'
import { orderPayment } from '../payments/payment.types.js'

export function createOrderRepository(db: Database.Database): OrderRepository {
  const orm = drizzle(db)
  return {
    getOrderForUser(userId, id) {
      const row = orm
        .select()
        .from(orders)
        .where(and(eq(orders.id, Number(id)), eq(orders.userId, userId)))
        .get()
      if (!row) return null
      return {
        id: String(row.id),
        createdAt: row.createdAt,
        totalCents: row.totalCents,
        status: row.status,
        payment: orderPayment(row),
        items: orm
          .select({
            title: orderItems.title,
            quantity: orderItems.quantity,
            unitPriceCents: orderItems.unitPriceCents,
          })
          .from(orderItems)
          .where(eq(orderItems.orderId, row.id))
          .orderBy(orderItems.id)
          .all(),
        history: orm
          .select({
            id: orderStatusEvents.id,
            fromStatus: orderStatusEvents.fromStatus,
            toStatus: orderStatusEvents.toStatus,
            createdAt: orderStatusEvents.createdAt,
            cancellationReason: orderStatusEvents.cancellationReason,
          })
          .from(orderStatusEvents)
          .where(eq(orderStatusEvents.orderId, row.id))
          .orderBy(orderStatusEvents.id)
          .all()
          .map((event) => ({ ...event, id: String(event.id) })),
      }
    },
    saveOrder(customer, items) {
      return orm.transaction((tx) => {
        const lines = items.map((item) => {
          const book = tx
            .select()
            .from(books)
            .where(eq(books.id, Number(item.bookId)))
            .get()
          if (!book) throw new ValidationError(`Book ${item.bookId} was not found`)
          if (book.archived)
            throw new ValidationError(
              `${book.title} is unavailable. Remove it from your cart to continue.`,
            )
          if (book.stock < item.quantity)
            throw new ValidationError(`${book.title} has only ${book.stock} in stock`)
          return { book, quantity: item.quantity }
        })
        const totalCents = lines.reduce(
          (total, line) => total + line.book.priceCents * line.quantity,
          0,
        )
        const order = tx
          .insert(orders)
          .values({
            userId: customer.id,
            customerName: customer.name,
            email: customer.email,
            totalCents,
            status: 'SUBMITTED',
          })
          .returning({ id: orders.id })
          .get()
        const role =
          tx.select().from(userRoles).where(eq(userRoles.userId, customer.id)).get()?.role ??
          'CUSTOMER'
        tx.insert(orderStatusEvents)
          .values({
            orderId: order.id,
            fromStatus: null,
            toStatus: 'SUBMITTED',
            actorUserId: customer.id,
            actorName: customer.name,
            actorRole: role,
          })
          .run()
        for (const { book, quantity } of lines) {
          const updated = tx
            .update(books)
            .set({ stock: sql`${books.stock} - ${quantity}` })
            .where(and(eq(books.id, book.id), gte(books.stock, quantity)))
            .run()
          if (updated.changes !== 1) throw new ValidationError(`${book.title} is out of stock`)
          tx.insert(orderItems)
            .values({
              orderId: order.id,
              bookId: book.id,
              title: book.title,
              quantity,
              unitPriceCents: book.priceCents,
            })
            .run()
        }
        return {
          id: String(order.id),
          status: 'SUBMITTED',
          totalCents,
          items: lines.map(({ book, quantity }) => ({
            title: book.title,
            quantity,
            unitPriceCents: book.priceCents,
          })),
        }
      })
    },
    listOrders(userId, limit, offset) {
      const where = eq(orders.userId, userId)
      const total = orm.select({ value: count() }).from(orders).where(where).get()?.value ?? 0
      const rows = orm
        .select()
        .from(orders)
        .where(where)
        .orderBy(desc(orders.createdAt), desc(orders.id))
        .limit(limit)
        .offset(offset)
        .all()
      const lines = rows.length
        ? orm
            .select({
              orderId: orderItems.orderId,
              title: orderItems.title,
              quantity: orderItems.quantity,
              unitPriceCents: orderItems.unitPriceCents,
            })
            .from(orderItems)
            .where(
              inArray(
                orderItems.orderId,
                rows.map((row) => row.id),
              ),
            )
            .all()
        : []
      return {
        total,
        items: rows.map((row) => ({
          id: String(row.id),
          createdAt: row.createdAt,
          status: row.status,
          totalCents: row.totalCents,
          payment: orderPayment(row),
          items: lines
            .filter((line) => line.orderId === row.id)
            .map(({ title, quantity, unitPriceCents }) => ({ title, quantity, unitPriceCents })),
        })),
      }
    },
  }
}
