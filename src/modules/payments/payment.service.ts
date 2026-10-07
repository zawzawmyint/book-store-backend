import type Database from 'better-sqlite3'
import { validated, numericIdSchema } from '../../shared/validation.js'
import { PaymentUnavailableError, ValidationError, ConflictError } from '../../shared/errors.js'
import { setOrderStatusSchema } from '../orders/order.validation.js'
import type { OrderCustomer } from '../orders/order.types.js'
import type { ActivityActor } from '../activity/activity.types.js'
import { ProviderRejection, type PaymentProvider, type ProviderEvent } from './payment.provider.js'
import { checkoutInputSchema } from './payment.validation.js'
import { createPaymentRepository } from './payment.repository.js'

export type PaymentOptions = {
  provider?: PaymentProvider
  now?: () => number
  frontendOrigin: string
}
export function createPaymentService(db: Database.Database, options: PaymentOptions) {
  // Cursor rotation keeps bounded sweeps fair even when old resources stay pending.
  let orderCursor = 0,
    eventCursor = ''
  const now = options.now ?? Date.now,
    repository = createPaymentRepository(db, now),
    provider = options.provider
  function requireProvider() {
    if (!provider) throw new PaymentUnavailableError()
    return provider
  }
  function readOrder(id: string, customer: OrderCustomer) {
    const order = repository.customerOrders.getOrderForUser(
      customer.id,
      validated(numericIdSchema, id),
    )
    if (!order) throw new ValidationError('Order was not found')
    return order
  }
  async function runOperation(id: string) {
    const api = requireProvider(),
      op = repository.claim(id)
    if (!op) {
      const current = repository.operation(id)
      if (current && current.state !== 'DONE' && current.state !== 'FAILED')
        throw new PaymentUnavailableError()
      return
    }
    const order = repository.get(op.orderId)!
    try {
      if (op.kind === 'CREATE_SESSION') {
        const s = await api.createSession(
          {
            orderId: String(order.id),
            expiresAt: Math.floor(Date.parse(order.expiresAt!) / 1000),
            lines: repository.lines(order.id).map((l) => ({
              title: l.title,
              quantity: l.quantity,
              unitPriceCents: l.unitPriceCents,
            })),
            successUrl: `${options.frontendOrigin}/checkout/return/${order.id}?outcome=success`,
            cancelUrl: `${options.frontendOrigin}/checkout/return/${order.id}?outcome=cancel`,
          },
          op.id,
        )
        repository.completeSession(op, s)
      } else {
        if (!order.stripePaymentIntentId) throw new Error('Payment association not yet available')
        const r = await api.createRefund(
          {
            orderId: String(order.id),
            paymentIntentId: order.stripePaymentIntentId,
            amountCents: order.totalCents,
          },
          op.id,
        )
        repository.saveRefund(op, r)
      }
    } catch (error) {
      repository.failOperation(op, error instanceof ProviderRejection)
      throw new PaymentUnavailableError()
    }
  }
  async function reconcile(id: number, expire = false) {
    const api = requireProvider()
    let row = repository.get(id)!
    try {
      if (!row.stripeSessionId && row.paymentStatus === 'PENDING') {
        await runOperation(`checkout:${id}`)
        row = repository.get(id)!
      }
      if (row.stripeRefundId && row.paymentStatus === 'REFUND_PENDING')
        repository.reconcileRefund(await api.retrieveRefund(row.stripeRefundId))
      if (row.stripeSessionId) {
        let session = await api.retrieveSession(row.stripeSessionId)
        if (
          !session.paid &&
          session.status === 'open' &&
          (expire || row.cancellationIntent || now() >= Date.parse(row.expiresAt!))
        ) {
          try {
            session = await api.expireSession(session.id)
          } catch {
            session = await api.retrieveSession(session.id)
            if (session.status === 'open') throw new PaymentUnavailableError()
          }
        }
        repository.reconcileSession(session)
      }
      row = repository.get(id)!
      if (row.cancellationIntent && row.paymentStatus === 'PAID') {
        const intent = JSON.parse(row.cancellationIntent) as {
          input: unknown
          actor: ActivityActor
        }
        repository.workflow.setStatus(validated(setOrderStatusSchema, intent.input), intent.actor)
      }
    } catch (error) {
      if (error instanceof ValidationError || error instanceof ConflictError) {
        if (error.message === 'Provider resource did not match saved order')
          repository.recordMismatch(row.stripeSessionId ?? String(id))
        throw error
      }
      throw new PaymentUnavailableError()
    }
  }
  async function processEvent(event: ProviderEvent) {
    const api = requireProvider()
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.expired')
      repository.reconcileSession(await api.retrieveSession(event.resourceId), event.id)
    else if (['refund.created', 'refund.updated', 'refund.failed'].includes(event.type))
      repository.reconcileRefund(await api.retrieveRefund(event.resourceId), event.id)
    else repository.finishEvent(event.id)
  }
  return {
    readOrder,
    async createCheckout(input: unknown, customer: OrderCustomer) {
      const parsed = validated(checkoutInputSchema, input)
      requireProvider()
      const order = repository.reserve(parsed, customer)
      if (order.paymentStatus === 'PENDING') await reconcile(order.id)
      const current = repository.get(order.id)!
      return {
        order: readOrder(String(order.id), customer),
        checkoutUrl:
          current.paymentStatus === 'PENDING' && !current.cancellationIntent
            ? current.checkoutUrl
            : null,
      }
    },
    async resumeCheckout(id: string, customer: OrderCustomer) {
      readOrder(id, customer)
      requireProvider()
      const order = repository.get(Number(id))!
      if (order.cancellationIntent) throw new PaymentUnavailableError()
      if (order.paymentStatus === 'PENDING') await reconcile(order.id)
      const current = repository.get(order.id)!
      return {
        order: readOrder(id, customer),
        checkoutUrl: current.paymentStatus === 'PENDING' ? current.checkoutUrl : null,
      }
    },
    async refreshOrderPayment(id: string, customer: OrderCustomer) {
      readOrder(id, customer)
      await reconcile(Number(id))
      return readOrder(id, customer)
    },
    async setOrderStatus(input: unknown, actor: ActivityActor) {
      const parsed = validated(setOrderStatusSchema, input),
        row = repository.get(Number(parsed.id))
      if (!row) throw new ValidationError('Order was not found')
      if (row.status === parsed.status) return repository.workflow.get(parsed.id)!
      if (row.status !== parsed.expectedStatus)
        throw new ConflictError('Order status changed. Refresh the request and try again.')
      if (parsed.status === 'CANCELLED' && row.paymentRequired && row.paymentStatus === 'PENDING') {
        if (!['SUBMITTED', 'ACCEPTED'].includes(row.status))
          throw new ValidationError('This order status transition is not allowed')
        requireProvider()
        repository.cancellationIntent(row.id, { input: parsed, actor })
        await reconcile(row.id, true)
        const result = repository.workflow.get(parsed.id)!
        if (result.status !== 'CANCELLED') throw new PaymentUnavailableError()
        return result
      }
      return repository.workflow.setStatus(parsed, actor)
    },
    async retryOrderRefund(id: string) {
      const row = repository.get(Number(validated(numericIdSchema, id)))
      if (!row) throw new ValidationError('Order was not found')
      if (
        row.status !== 'CANCELLED' ||
        !['REFUND_FAILED', 'REFUND_PENDING', 'REFUNDED'].includes(row.paymentStatus)
      )
        throw new ValidationError('This order does not have a retryable refund')
      if (row.paymentStatus === 'REFUND_FAILED') {
        requireProvider()
        repository.queueRefund(row.id)
        const ops = repository
          .queuedOperations()
          .filter((op) => op.orderId === row.id && op.kind === 'REFUND')
        for (const op of ops) await runOperation(op.id)
      }
      return repository.workflow.get(id)!
    },
    async handleEvent(event: ProviderEvent) {
      repository.queueEvent(event)
      await processEvent(event)
    },
    async recover() {
      if (!provider) return
      for (const op of repository.queuedOperations()) {
        try {
          await runOperation(op.id)
        } catch {
          /* durable safe error + backoff */
        }
      }
      let events = repository.pendingEvents(eventCursor)
      if (!events.length) {
        eventCursor = ''
        events = repository.pendingEvents()
      }
      for (const event of events) {
        eventCursor = event.id
        try {
          await processEvent(event)
        } catch {
          /* retained for the next sweep */
        }
      }
      let pending = repository.pendingOrders(orderCursor)
      if (!pending.length) {
        orderCursor = 0
        pending = repository.pendingOrders()
      }
      for (const order of pending) {
        orderCursor = order.id
        try {
          await reconcile(order.id)
        } catch {
          /* reservation remains until provider confirms */
        }
      }
    },
  }
}
