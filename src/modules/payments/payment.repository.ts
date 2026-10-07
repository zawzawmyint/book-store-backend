import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { and, eq, gt, isNull, lte, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import {
  books,
  checkoutRequests,
  orderItems,
  orders,
  paymentEvents,
  paymentOperations,
} from '../../database/schema.js'
import { ConflictError, ValidationError } from '../../shared/errors.js'
import { createOrderRepository } from '../orders/order.repository.js'
import { createAdminOrderRepository } from '../orders/admin-order.repository.js'
import { insertActivity } from '../activity/activity.writer.js'
import { systemActor, type ActivityActor } from '../activity/activity.types.js'
import type { ProviderEvent, ProviderRefund, ProviderSession } from './payment.provider.js'
import type { OrderCustomer, OrderItemInput } from '../orders/order.types.js'

export function createPaymentRepository(db: Database.Database, now: () => number) {
  const orm = drizzle(db),
    customerOrders = createOrderRepository(db),
    workflow = createAdminOrderRepository(db)
  const get = (id: number) => orm.select().from(orders).where(eq(orders.id, id)).get()
  const operation = (id: string) =>
    orm.select().from(paymentOperations).where(eq(paymentOperations.id, id)).get()
  function paymentChange(
    id: number,
    status: typeof orders.$inferSelect.paymentStatus,
    extra: Partial<typeof orders.$inferInsert> = {},
  ) {
    const before = get(id)!
    orm
      .update(orders)
      .set({ paymentStatus: status, ...extra })
      .where(eq(orders.id, id))
      .run()
    if (before.paymentStatus !== status)
      insertActivity(orm, systemActor, {
        action: 'ORDER_PAYMENT_CHANGED',
        targetType: 'ORDER',
        targetId: String(id),
        targetName: `Order request #${id}`,
        changes: [{ field: 'ORDER_PAYMENT_STATUS', before: before.paymentStatus, after: status }],
      })
  }
  function queueRefund(id: number) {
    const existing = orm
      .select()
      .from(paymentOperations)
      .where(and(eq(paymentOperations.orderId, id), eq(paymentOperations.kind, 'REFUND')))
      .all()
    if (
      existing.some((op) => op.state === 'PENDING' || op.state === 'DONE' || op.state === 'MANUAL')
    )
      return
    paymentChange(id, 'REFUND_PENDING', { stripeRefundId: null })
    orm
      .insert(paymentOperations)
      .values({
        id: `refund:${id}:${existing.length + 1}`,
        orderId: id,
        kind: 'REFUND',
        createdAt: now(),
        retryAt: 0,
      })
      .run()
  }
  function sessionMatches(row: typeof orders.$inferSelect, s: ProviderSession) {
    return (
      !s.livemode &&
      s.id === row.stripeSessionId &&
      s.orderId === String(row.id) &&
      s.amountCents === row.totalCents &&
      s.currency === 'usd' &&
      (!row.stripePaymentIntentId || row.stripePaymentIntentId === s.paymentIntentId) &&
      (!s.paid ||
        (s.status === 'complete' &&
          s.paymentIntentId &&
          s.intentOrderId === String(row.id) &&
          s.intentAmountCents === row.totalCents &&
          s.intentCurrency === 'usd' &&
          s.intentSucceeded))
    )
  }
  function reconcileSession(s: ProviderSession, eventId?: string) {
    return db
      .transaction(() => {
        if (
          eventId &&
          orm.select().from(paymentEvents).where(eq(paymentEvents.id, eventId)).get()?.processedAt
        )
          return
        const row = orm.select().from(orders).where(eq(orders.stripeSessionId, s.id)).get()
        if (!row) {
          if (eventId) finishEvent(eventId)
          return
        }
        if (!sessionMatches(row, s)) {
          if (eventId) finishEvent(eventId, 'Provider resource did not match saved order')
          else throw new ValidationError('Provider resource did not match saved order')
          return
        }
        if (s.paid) {
          if (row.paymentStatus === 'PENDING' || row.paymentStatus === 'EXPIRED') {
            paymentChange(row.id, 'PAID', {
              paidAt: new Date(now()).toISOString(),
              stripePaymentIntentId: s.paymentIntentId,
              checkoutUrl: null,
            })
            if (row.status === 'CANCELLED') queueRefund(row.id)
          }
        } else if (s.status === 'expired' && row.paymentStatus === 'PENDING') {
          const intent = row.cancellationIntent
            ? (JSON.parse(row.cancellationIntent) as {
                input: Parameters<typeof workflow.setStatus>[0]
                actor: ActivityActor
              })
            : null
          workflow.setStatus(
            intent?.input ?? {
              id: String(row.id),
              expectedStatus: row.status,
              status: 'CANCELLED',
              cancellationReason: 'Payment window expired',
            },
            intent?.actor ?? systemActor,
            true,
          )
          paymentChange(row.id, 'EXPIRED', { checkoutUrl: null })
        }
        if (eventId) finishEvent(eventId)
      })
      .immediate()
  }
  function finishEvent(id: string, error?: string) {
    orm
      .update(paymentEvents)
      .set({ processedAt: now(), safeError: error ?? null })
      .where(eq(paymentEvents.id, id))
      .run()
  }
  return {
    get,
    operation,
    customerOrders,
    workflow,
    lines(id: number) {
      return orm.select().from(orderItems).where(eq(orderItems.orderId, id)).all()
    },
    reserve(input: { items: OrderItemInput[]; requestKey: string }, customer: OrderCustomer) {
      return db
        .transaction(() => {
          const linesJson = JSON.stringify(
            [...input.items].sort((a, b) => Number(a.bookId) - Number(b.bookId)),
          )
          const prior = orm
            .select()
            .from(checkoutRequests)
            .where(
              and(
                eq(checkoutRequests.userId, customer.id),
                eq(checkoutRequests.requestKey, input.requestKey),
              ),
            )
            .get()
          if (prior) {
            if (prior.linesJson !== linesJson)
              throw new ConflictError('Request key was already used with different books')
            return get(prior.orderId)!
          }
          const total = input.items.reduce((sum, line) => {
            const b = orm
              .select()
              .from(books)
              .where(eq(books.id, Number(line.bookId)))
              .get()
            if (!b) throw new ValidationError(`Book ${line.bookId} was not found`)
            return sum + b.priceCents * line.quantity
          }, 0)
          if (!Number.isSafeInteger(total) || total < 50 || total > 2147483647)
            throw new ValidationError('Checkout total must be between 50 and 2147483647 cents')
          const saved = customerOrders.saveOrder(customer, input.items),
            id = Number(saved.id)
          // Stable across retries; the minute guard avoids Stripe's 30-minute minimum
          // rejecting a timestamp reduced by rounding or network latency.
          orm
            .update(orders)
            .set({
              paymentRequired: true,
              paymentStatus: 'PENDING',
              expiresAt: new Date(now() + 1860000).toISOString(),
            })
            .where(eq(orders.id, id))
            .run()
          orm
            .insert(checkoutRequests)
            .values({ userId: customer.id, requestKey: input.requestKey, linesJson, orderId: id })
            .run()
          orm
            .insert(paymentOperations)
            .values({
              id: `checkout:${id}`,
              orderId: id,
              kind: 'CREATE_SESSION',
              createdAt: now(),
              retryAt: 0,
            })
            .run()
          return get(id)!
        })
        .immediate()
    },
    claim(id: string) {
      return db
        .transaction(() => {
          const op = operation(id)
          if (!op || op.state !== 'PENDING' || op.leaseUntil > now() || op.retryAt > now())
            return null
          if (now() - op.createdAt >= 86400000) {
            orm
              .update(paymentOperations)
              .set({
                state: 'MANUAL',
                safeError: 'Manual provider reconciliation required',
                leaseUntil: 0,
                leaseToken: null,
              })
              .where(eq(paymentOperations.id, id))
              .run()
            return null
          }
          const token = randomUUID()
          orm
            .update(paymentOperations)
            .set({ leaseUntil: now() + 30000, leaseToken: token, attempts: op.attempts + 1 })
            .where(eq(paymentOperations.id, id))
            .run()
          return { ...op, leaseToken: token, attempts: op.attempts + 1 }
        })
        .immediate()
    },
    completeSession(op: typeof paymentOperations.$inferSelect, s: ProviderSession) {
      db.transaction(() => {
        if (operation(op.id)?.leaseToken !== op.leaseToken) return
        const row = get(op.orderId)!
        // Association is saved before validating payment evidence, in the same transaction.
        orm
          .update(orders)
          .set({
            stripeSessionId: s.id,
            checkoutUrl: s.url,
            expiresAt: new Date(s.expiresAt * 1000).toISOString(),
          })
          .where(eq(orders.id, row.id))
          .run()
        reconcileSession(s)
        orm
          .update(paymentOperations)
          .set({ state: 'DONE', leaseUntil: 0, leaseToken: null, safeError: null })
          .where(eq(paymentOperations.id, op.id))
          .run()
      }).immediate()
    },
    failOperation(op: typeof paymentOperations.$inferSelect, definitive: boolean) {
      db.transaction(() => {
        if (operation(op.id)?.leaseToken !== op.leaseToken) return
        if (definitive) {
          if (op.kind === 'CREATE_SESSION') {
            workflow.setStatus(
              {
                id: String(op.orderId),
                expectedStatus: 'SUBMITTED',
                status: 'CANCELLED',
                cancellationReason: 'Payment could not be started',
              },
              systemActor,
              true,
            )
            paymentChange(op.orderId, 'EXPIRED')
          } else paymentChange(op.orderId, 'REFUND_FAILED')
        }
        orm
          .update(paymentOperations)
          .set({
            state: definitive ? 'FAILED' : 'PENDING',
            safeError: definitive ? 'Provider operation rejected' : 'Provider confirmation delayed',
            retryAt: now() + Math.min(60000 * 2 ** Math.min(op.attempts - 1, 5), 1800000),
            leaseUntil: 0,
            leaseToken: null,
          })
          .where(eq(paymentOperations.id, op.id))
          .run()
      }).immediate()
    },
    saveRefund(op: typeof paymentOperations.$inferSelect, r: ProviderRefund) {
      db.transaction(() => {
        if (operation(op.id)?.leaseToken !== op.leaseToken) return
        orm.update(orders).set({ stripeRefundId: r.id }).where(eq(orders.id, op.orderId)).run()
        reconcileRefund(r)
        orm
          .update(paymentOperations)
          .set({
            state: r.status === 'failed' ? 'FAILED' : 'DONE',
            leaseUntil: 0,
            leaseToken: null,
            safeError: r.status === 'failed' ? 'Refund failed' : null,
          })
          .where(eq(paymentOperations.id, op.id))
          .run()
      }).immediate()
    },
    reconcileSession,
    reconcileRefund,
    queueRefund(id: number) {
      db.transaction(() => queueRefund(id)).immediate()
    },
    cancellationIntent(id: number, intent: unknown) {
      orm
        .update(orders)
        .set({ cancellationIntent: JSON.stringify(intent) })
        .where(and(eq(orders.id, id), isNull(orders.cancellationIntent)))
        .run()
    },
    queuedOperations() {
      return orm
        .select()
        .from(paymentOperations)
        .where(
          and(
            eq(paymentOperations.state, 'PENDING'),
            lte(paymentOperations.retryAt, now()),
            lte(paymentOperations.leaseUntil, now()),
          ),
        )
        .limit(20)
        .all()
    },
    pendingOrders(afterId = 0) {
      return orm
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.paymentRequired, true),
            gt(orders.id, afterId),
            sql`(${orders.paymentStatus} IN ('PENDING','REFUND_PENDING') OR ${orders.cancellationIntent} IS NOT NULL)`,
          ),
        )
        .orderBy(orders.id)
        .limit(20)
        .all()
    },
    queueEvent(event: ProviderEvent) {
      orm
        .insert(paymentEvents)
        .values({ ...event, receivedAt: now() })
        .onConflictDoNothing()
        .run()
    },
    pendingEvents(afterId = '') {
      return orm
        .select()
        .from(paymentEvents)
        .where(and(isNull(paymentEvents.processedAt), gt(paymentEvents.id, afterId)))
        .orderBy(paymentEvents.id)
        .limit(20)
        .all()
    },
    finishEvent,
    recordMismatch(resourceId: string) {
      orm
        .insert(paymentEvents)
        .values({
          id: `review:${randomUUID()}`,
          resourceId,
          type: 'RECONCILIATION',
          receivedAt: now(),
          processedAt: now(),
          safeError: 'Provider resource did not match saved order',
        })
        .run()
    },
  }
  function reconcileRefund(r: ProviderRefund, eventId?: string) {
    db.transaction(() => {
      if (
        eventId &&
        orm.select().from(paymentEvents).where(eq(paymentEvents.id, eventId)).get()?.processedAt
      )
        return
      const row = orm.select().from(orders).where(eq(orders.stripeRefundId, r.id)).get()
      if (!row) {
        if (eventId) finishEvent(eventId)
        return
      }
      if (
        r.livemode ||
        r.paymentIntentId !== row.stripePaymentIntentId ||
        r.orderId !== String(row.id) ||
        r.amountCents !== row.totalCents ||
        r.currency !== 'usd' ||
        row.status !== 'CANCELLED'
      ) {
        if (eventId) finishEvent(eventId, 'Provider resource did not match saved order')
        else throw new ValidationError('Provider resource did not match saved order')
        return
      }
      if (row.paymentStatus !== 'REFUNDED')
        paymentChange(
          row.id,
          r.status === 'succeeded'
            ? 'REFUNDED'
            : r.status === 'failed'
              ? 'REFUND_FAILED'
              : 'REFUND_PENDING',
          r.status === 'succeeded' ? { refundedAt: new Date(now()).toISOString() } : {},
        )
      if (r.status === 'failed')
        orm
          .update(paymentOperations)
          .set({ state: 'FAILED', safeError: 'Refund failed' })
          .where(
            and(
              eq(paymentOperations.orderId, row.id),
              eq(paymentOperations.kind, 'REFUND'),
              sql`${paymentOperations.state} != 'MANUAL'`,
            ),
          )
          .run()
      if (eventId) finishEvent(eventId)
    }).immediate()
  }
}
