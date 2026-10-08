import { readDelivery } from './delivery.mapping.js'
import { normalizeStore, type DatabaseInput } from '../../database/persistence.js'
import { ValidationError } from '../../shared/errors.js'
import type { OrderRepository } from './order.types.js'
import { orderPayment } from '../payments/payment.types.js'
export function createOrderRepository(input: DatabaseInput): OrderRepository {
  const store = normalizeStore(input)
  return {
    async getOrderForUser(userId, id) {
      const row = await store.order(Number(id))
      if (!row || row.userId !== userId) return null
      return {
        id: String(row.id),
        createdAt: row.createdAt,
        subtotalCents: row.subtotalCents,
        deliveryFeeCents: row.deliveryFeeCents,
        delivery: await readDelivery(store, row.id),
        totalCents: row.totalCents,
        status: row.status,
        payment: orderPayment(row),
        items: await store.lines([row.id]),
        history: (await store.history(row.id)).map((e) => ({ ...e, id: String(e.id) })),
      }
    },
    async saveOrder(customer, items, delivery) {
      return store.transaction(async (tx) => {
        const lines = []
        for (const item of [...items].sort((a, b) => Number(a.bookId) - Number(b.bookId))) {
          const book = await tx.book(Number(item.bookId))
          if (!book) throw new ValidationError(`Book ${item.bookId} was not found`)
          if (book.archived)
            throw new ValidationError(
              `${book.title} is unavailable. Remove it from your cart to continue.`,
            )
          if (book.stock < item.quantity)
            throw new ValidationError(`${book.title} has only ${book.stock} in stock`)
          lines.push({ book, quantity: item.quantity })
        }
        // Lock order is deterministic; the customer's line order remains intact.
        lines.sort(
          (a, b) =>
            items.findIndex((item) => Number(item.bookId) === a.book.id) -
            items.findIndex((item) => Number(item.bookId) === b.book.id),
        )
        const subtotalCents = lines.reduce((n, l) => n + l.book.priceCents * l.quantity, 0)
        const totalCents = subtotalCents + delivery.feeCents
        const order = await tx.createOrder({
          userId: customer.id,
          customerName: customer.name,
          email: customer.email,
          subtotalCents,
          deliveryFeeCents: delivery.feeCents,
          totalCents,
          status: 'SUBMITTED',
          paymentRequired: true,
          paymentStatus: 'PENDING',
        })
        await tx.insertDelivery({ orderId: order.id, ...delivery.address })
        await tx.insertHistory({
          orderId: order.id,
          fromStatus: null,
          toStatus: 'SUBMITTED',
          actorUserId: customer.id,
          actorName: customer.name,
          actorRole: await tx.role(customer.id),
        })
        for (const { book, quantity } of lines) {
          if (!(await tx.adjustStock(book.id, -quantity)))
            throw new ValidationError(`${book.title} is out of stock`)
          await tx.insertLine({
            orderId: order.id,
            bookId: book.id,
            title: book.title,
            quantity,
            unitPriceCents: book.priceCents,
          })
        }
        return {
          id: String(order.id),
          status: order.status,
          delivery: await readDelivery(tx, order.id),
          subtotalCents,
          deliveryFeeCents: delivery.feeCents,
          totalCents,
          items: lines.map(({ book, quantity }) => ({
            title: book.title,
            quantity,
            unitPriceCents: book.priceCents,
          })),
        }
      })
    },
    async listOrders(userId, limit, offset) {
      const page = await store.orderPage(limit, offset, userId),
        lines = await store.lines(page.items.map((r) => r.id))
      return {
        total: page.total,
        items: page.items.map((row) => ({
          id: String(row.id),
          createdAt: row.createdAt,
          status: row.status,
          subtotalCents: row.subtotalCents,
          deliveryFeeCents: row.deliveryFeeCents,

          totalCents: row.totalCents,
          payment: orderPayment(row),
          items: lines.filter((l) => l.orderId === row.id),
        })),
      }
    },
  }
}
