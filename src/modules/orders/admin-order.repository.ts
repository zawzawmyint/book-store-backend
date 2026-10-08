import type { z } from 'zod'
import type { setOrderStatusSchema } from './order.validation.js'
import type { OrderStatus } from './order.types.js'
import type { ActivityActor } from '../activity/activity.types.js'
import { insertActivity } from '../activity/activity.writer.js'
import { ValidationError, ConflictError } from '../../shared/errors.js'
import { normalizeStore, type DatabaseInput } from '../../database/persistence.js'
import type { DomainStore, OrderRow } from '../../database/store.types.js'
import { orderPayment } from '../payments/payment.types.js'
export function createAdminOrderRepository(input: DatabaseInput) {
  const store = normalizeStore(input)
  async function withLines(tx: DomainStore, rows: OrderRow[]) {
    const lines = await tx.lines(rows.map((r) => r.id))
    return rows.map((row) => ({
      ...row,
      id: String(row.id),
      payment: orderPayment(row),
      items: lines
        .filter((l) => l.orderId === row.id)
        .map(({ title, quantity, unitPriceCents }) => ({ title, quantity, unitPriceCents })),
    }))
  }
  async function get(id: string, tx = store) {
    const row = await tx.order(Number(id))
    return row ? (await withLines(tx, [row]))[0] : null
  }
  return {
    async history(id: string) {
      return (await store.history(Number(id))).map((r) => ({ ...r, id: String(r.id) }))
    },
    get,
    setStatus(
      input: z.infer<typeof setOrderStatusSchema>,
      actor: ActivityActor,
      sessionClosed = false,
    ) {
      return store.transaction(async (tx) => {
        const before = await tx.order(Number(input.id))
        if (!before) throw new ValidationError('Order was not found')
        if (before.status === input.status) return (await get(input.id, tx))!
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
        if (
          !(await tx.updateOrder(
            before.id,
            { status: input.status, cancellationIntent: null },
            input.expectedStatus,
          ))
        )
          throw new ConflictError('Order status changed')
        if (input.status === 'CANCELLED') {
          const quantities = new Map<number, number>()
          for (const line of await tx.lines([before.id])) {
            if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 10)
              throw new ValidationError('Saved order quantity is outside supported limits')
            quantities.set(line.bookId, (quantities.get(line.bookId) ?? 0) + line.quantity)
          }
          for (const [bookId, quantity] of [...quantities].sort((a, b) => a[0] - b[0])) {
            const book = await tx.book(bookId)
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
            const next = await tx.adjustStock(bookId, quantity)
            if (!next)
              throw new ValidationError(
                'Saved inventory cannot be restored within supported limits',
              )
            await insertActivity(tx, actor, {
              action: 'BOOK_STOCK_ADJUSTED',
              targetType: 'BOOK',
              targetId: String(bookId),
              targetName: book.title,
              stockDelta: quantity,
              changes: [{ field: 'STOCK', before: String(book.stock), after: String(next.stock) }],
            })
          }
        }
        if (actor.source === 'OPERATOR')
          throw new ValidationError('Order processing requires an account')
        await tx.insertHistory({
          orderId: before.id,
          fromStatus: before.status,
          toStatus: input.status,
          cancellationReason: input.cancellationReason ?? null,
          actorUserId: actor.userId,
          actorName: actor.name,
          actorRole: actor.role,
          actorType: actor.source === 'SYSTEM' ? 'SYSTEM' : 'USER',
        })
        await insertActivity(tx, actor, {
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
          await tx.updateOrder(before.id, { paymentStatus: 'REFUND_PENDING' })
          await tx.insertOperation({
            id: `refund:${before.id}:1`,
            orderId: before.id,
            kind: 'REFUND',
            createdAt: Date.now(),
            retryAt: 0,
          })
          await insertActivity(tx, actor, {
            action: 'ORDER_PAYMENT_CHANGED',
            targetType: 'ORDER',
            targetId: input.id,
            targetName: `Order request #${input.id}`,
            changes: [{ field: 'ORDER_PAYMENT_STATUS', before: 'PAID', after: 'REFUND_PENDING' }],
          })
        }
        return (await get(input.id, tx))!
      })
    },
    async list(limit: number, offset: number, status: 'ALL' | OrderStatus = 'ALL') {
      const page = await store.orderPage(
        limit,
        offset,
        undefined,
        status === 'ALL' ? undefined : status,
      )
      return { total: page.total, items: await withLines(store, page.items) }
    },
  }
}
