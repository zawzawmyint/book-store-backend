import { randomUUID } from 'node:crypto'
import { normalizeStore, type DatabaseInput } from '../../database/persistence.js'
import type { DomainStore, OrderRow, OperationRow } from '../../database/store.types.js'
import { ConflictError, ValidationError } from '../../shared/errors.js'
import { createOrderRepository } from '../orders/order.repository.js'
import { createAdminOrderRepository } from '../orders/admin-order.repository.js'
import { insertActivity } from '../activity/activity.writer.js'
import { systemActor, type ActivityActor } from '../activity/activity.types.js'
import type { ProviderEvent, ProviderRefund, ProviderSession } from './payment.provider.js'
import type { OrderCustomer, OrderItemInput } from '../orders/order.types.js'
export function createPaymentRepository(input: DatabaseInput, now: () => number) {
  const store = normalizeStore(input)
  async function paymentChange(
    tx: DomainStore,
    id: number,
    status: OrderRow['paymentStatus'],
    extra: Partial<OrderRow> = {},
  ) {
    const before = (await tx.order(id))!
    await tx.updateOrder(id, { paymentStatus: status, ...extra })
    if (before.paymentStatus !== status)
      await insertActivity(tx, systemActor, {
        action: 'ORDER_PAYMENT_CHANGED',
        targetType: 'ORDER',
        targetId: String(id),
        targetName: `Order request #${id}`,
        changes: [{ field: 'ORDER_PAYMENT_STATUS', before: before.paymentStatus, after: status }],
      })
  }
  async function queueRefund(tx: DomainStore, id: number) {
    await tx.order(id)
    const existing = await tx.refundOperations(id)
    if (existing.some((op) => ['PENDING', 'DONE', 'MANUAL'].includes(op.state))) return
    await paymentChange(tx, id, 'REFUND_PENDING', { stripeRefundId: null })
    await tx.insertOperation({
      id: `refund:${id}:${existing.length + 1}`,
      orderId: id,
      kind: 'REFUND',
      createdAt: now(),
      retryAt: 0,
    })
  }
  function sessionMatches(row: OrderRow, s: ProviderSession) {
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
  async function finishEvent(tx: DomainStore, id: string, error?: string) {
    await tx.updateEvent(id, { processedAt: now(), safeError: error ?? null })
  }
  async function reconcileSessionIn(tx: DomainStore, s: ProviderSession, eventId?: string) {
    if (eventId && (await tx.event(eventId))?.processedAt) return
    const row = await tx.orderBySession(s.id)
    if (!row) {
      if (eventId) await finishEvent(tx, eventId)
      return
    }
    if (!sessionMatches(row, s)) {
      if (eventId) await finishEvent(tx, eventId, 'Provider resource did not match saved order')
      else throw new ValidationError('Provider resource did not match saved order')
      return
    }
    if (s.paid) {
      if (row.paymentStatus === 'PENDING' || row.paymentStatus === 'EXPIRED') {
        await paymentChange(tx, row.id, 'PAID', {
          paidAt: new Date(now()).toISOString(),
          stripePaymentIntentId: s.paymentIntentId,
          checkoutUrl: null,
        })
        if (row.status === 'CANCELLED') await queueRefund(tx, row.id)
      }
    } else if (s.status === 'expired' && row.paymentStatus === 'PENDING') {
      const workflow = createAdminOrderRepository(tx)
      const intent = row.cancellationIntent
        ? (JSON.parse(row.cancellationIntent) as {
            input: Parameters<typeof workflow.setStatus>[0]
            actor: ActivityActor
          })
        : null
      await workflow.setStatus(
        intent?.input ?? {
          id: String(row.id),
          expectedStatus: row.status,
          status: 'CANCELLED',
          cancellationReason: 'Payment window expired',
        },
        intent?.actor ?? systemActor,
        true,
      )
      await paymentChange(tx, row.id, 'EXPIRED', { checkoutUrl: null })
    }
    if (eventId) await finishEvent(tx, eventId)
  }
  async function reconcileRefundIn(tx: DomainStore, r: ProviderRefund, eventId?: string) {
    if (eventId && (await tx.event(eventId))?.processedAt) return
    const row = await tx.orderByRefund(r.id)
    if (!row) {
      if (eventId) await finishEvent(tx, eventId)
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
      if (eventId) await finishEvent(tx, eventId, 'Provider resource did not match saved order')
      else throw new ValidationError('Provider resource did not match saved order')
      return
    }
    if (row.paymentStatus !== 'REFUNDED')
      await paymentChange(
        tx,
        row.id,
        r.status === 'succeeded'
          ? 'REFUNDED'
          : r.status === 'failed'
            ? 'REFUND_FAILED'
            : 'REFUND_PENDING',
        r.status === 'succeeded' ? { refundedAt: new Date(now()).toISOString() } : {},
      )
    if (r.status === 'failed')
      for (const op of await tx.refundOperations(row.id))
        if (op.state !== 'MANUAL')
          await tx.updateOperation(op.id, { state: 'FAILED', safeError: 'Refund failed' })
    if (eventId) await finishEvent(tx, eventId)
  }
  // Lock the order before its operation everywhere, preventing lease/order deadlocks.
  async function owned(tx: DomainStore, op: OperationRow) {
    await tx.order(op.orderId)
    return (await tx.operation(op.id))?.leaseToken === op.leaseToken && !!op.leaseToken
  }
  return {
    get: (id: number) => store.order(id),
    operation: (id: string) => store.operation(id),
    customerOrders: createOrderRepository(store),
    workflow: createAdminOrderRepository(store),
    lines: (id: number) => store.lines([id]),
    reserve(input: { items: OrderItemInput[]; requestKey: string }, customer: OrderCustomer) {
      return store.transaction(async (tx) => {
        const sorted = [...input.items].sort((a, b) => Number(a.bookId) - Number(b.bookId)),
          linesJson = JSON.stringify(sorted)
        const prior = await tx.checkout(customer.id, input.requestKey)
        if (prior) {
          if (prior.linesJson !== linesJson)
            throw new ConflictError('Request key was already used with different books')
          return (await tx.order(prior.orderId))!
        }
        let total = 0
        for (const line of sorted) {
          const book = await tx.book(Number(line.bookId))
          if (!book) throw new ValidationError(`Book ${line.bookId} was not found`)
          total += book.priceCents * line.quantity
        }
        if (!Number.isSafeInteger(total) || total < 50 || total > 2147483647)
          throw new ValidationError('Checkout total must be between 50 and 2147483647 cents')
        const saved = await createOrderRepository(tx).saveOrder(customer, input.items),
          id = Number(saved.id)
        await tx.updateOrder(id, {
          paymentRequired: true,
          paymentStatus: 'PENDING',
          expiresAt: new Date(now() + 1860000).toISOString(),
        })
        await tx.insertCheckout({
          userId: customer.id,
          requestKey: input.requestKey,
          linesJson,
          orderId: id,
        })
        await tx.insertOperation({
          id: `checkout:${id}`,
          orderId: id,
          kind: 'CREATE_SESSION',
          createdAt: now(),
          retryAt: 0,
        })
        return (await tx.order(id))!
      })
    },
    async claim(id: string) {
      const prior = await store.operation(id)
      if (!prior) return null
      return store.transaction(async (tx) => {
        await tx.order(prior.orderId)
        const op = await tx.operation(id)
        if (!op || op.state !== 'PENDING' || op.leaseUntil > now() || op.retryAt > now())
          return null
        if (now() - op.createdAt >= 86400000) {
          await tx.updateOperation(id, {
            state: 'MANUAL',
            safeError: 'Manual provider reconciliation required',
            leaseUntil: 0,
            leaseToken: null,
          })
          return null
        }
        const token = randomUUID(),
          attempts = op.attempts + 1
        await tx.updateOperation(id, { leaseUntil: now() + 30000, leaseToken: token, attempts })
        return { ...op, leaseToken: token, attempts }
      })
    },
    completeSession(op: OperationRow, s: ProviderSession) {
      return store.transaction(async (tx) => {
        if (!(await owned(tx, op))) return
        await tx.updateOrder(op.orderId, {
          stripeSessionId: s.id,
          checkoutUrl: s.url,
          expiresAt: new Date(s.expiresAt * 1000).toISOString(),
        })
        await reconcileSessionIn(tx, s)
        await tx.updateOperation(
          op.id,
          { state: 'DONE', leaseUntil: 0, leaseToken: null, safeError: null },
          op.leaseToken!,
        )
      })
    },
    failOperation(op: OperationRow, definitive: boolean) {
      return store.transaction(async (tx) => {
        if (!(await owned(tx, op))) return
        if (definitive) {
          if (op.kind === 'CREATE_SESSION') {
            await createAdminOrderRepository(tx).setStatus(
              {
                id: String(op.orderId),
                expectedStatus: 'SUBMITTED',
                status: 'CANCELLED',
                cancellationReason: 'Payment could not be started',
              },
              systemActor,
              true,
            )
            await paymentChange(tx, op.orderId, 'EXPIRED')
          } else await paymentChange(tx, op.orderId, 'REFUND_FAILED')
        }
        await tx.updateOperation(
          op.id,
          {
            state: definitive ? 'FAILED' : 'PENDING',
            safeError: definitive ? 'Provider operation rejected' : 'Provider confirmation delayed',
            retryAt: now() + Math.min(60000 * 2 ** Math.min(op.attempts - 1, 5), 1800000),
            leaseUntil: 0,
            leaseToken: null,
          },
          op.leaseToken!,
        )
      })
    },
    saveRefund(op: OperationRow, r: ProviderRefund) {
      return store.transaction(async (tx) => {
        if (!(await owned(tx, op))) return
        await tx.updateOrder(op.orderId, { stripeRefundId: r.id })
        await reconcileRefundIn(tx, r)
        await tx.updateOperation(
          op.id,
          {
            state: r.status === 'failed' ? 'FAILED' : 'DONE',
            leaseUntil: 0,
            leaseToken: null,
            safeError: r.status === 'failed' ? 'Refund failed' : null,
          },
          op.leaseToken!,
        )
      })
    },
    reconcileSession: (s: ProviderSession, eventId?: string) =>
      store.transaction((tx) => reconcileSessionIn(tx, s, eventId)),
    reconcileRefund: (r: ProviderRefund, eventId?: string) =>
      store.transaction((tx) => reconcileRefundIn(tx, r, eventId)),
    queueRefund: (id: number) => store.transaction((tx) => queueRefund(tx, id)),
    cancellationIntent(id: number, intent: unknown) {
      return store.transaction(async (tx) => {
        const row = await tx.order(id)
        if (row && !row.cancellationIntent)
          await tx.updateOrder(id, { cancellationIntent: JSON.stringify(intent) })
      })
    },
    queuedOperations: () => store.queuedOperations(now()),
    pendingOrders: (id = 0) => store.pendingOrders(id),
    queueEvent: (event: ProviderEvent) => store.insertEvent({ ...event, receivedAt: now() }),
    pendingEvents: (id = '') => store.pendingEvents(id),
    finishEvent: (id: string, error?: string) => finishEvent(store, id, error),
    recordMismatch: (resourceId: string) =>
      store.insertEvent({
        id: `review:${randomUUID()}`,
        resourceId,
        type: 'RECONCILIATION',
        receivedAt: now(),
        processedAt: now(),
        safeError: 'Provider resource did not match saved order',
      }),
  }
}
