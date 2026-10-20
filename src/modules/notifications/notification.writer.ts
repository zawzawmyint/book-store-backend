import { randomUUID } from 'node:crypto'
import { normalizeStore, type DatabaseInput } from '../../database/persistence.js'
import type { DomainStore, InAppNotificationDraft, OrderRow } from '../../database/store.types.js'
import type {
  NotificationHint,
  NotificationKind,
  NotificationPayload,
} from './notification.types.js'
type Options = { enabled: boolean; publish?: (hint: NotificationHint) => Promise<void> }
function band(stock: number) {
  return stock === 0 ? 'OUT' : stock <= 5 ? 'LOW' : 'HEALTHY'
}
/** Decorates transaction scopes, never a global event buffer. Durable rows commit with domain writes. */
export function createNotificationStore(input: DatabaseInput, options: Options): DomainStore {
  const base = normalizeStore(input)
  if (!options.enabled) return base
  async function publish(hints: Map<string, NotificationHint>) {
    await Promise.allSettled(
      [...hints.values()].map((h) => Promise.resolve().then(() => options.publish?.(h))),
    )
  }
  function scope(
    raw: DomainStore,
    hints: Map<string, NotificationHint>,
    pending: (() => Promise<void>)[],
  ): DomainStore {
    const hint = (h: NotificationHint) => {
      hints.set(`${h.recipientId}:${h.scope}`, h)
    }
    async function write(
      kind: NotificationKind,
      eventKey: string,
      resourceType: 'ORDER' | 'BOOK',
      resourceId: string,
      payload: NotificationPayload,
      customerId?: string | null,
    ) {
      const adminOnly = kind === 'REFUND_FAILED',
        workspace = ['NEW_PAID_ORDER', 'STOCK_LOW', 'STOCK_OUT', 'REFUND_FAILED'].includes(kind)
      const recipients = workspace
        ? await raw.inAppRecipients(adminOnly)
        : customerId && (await raw.user(customerId))?.emailVerified
          ? [customerId]
          : []
      for (const recipientId of recipients) {
        const scope = workspace ? 'WORKSPACE' : 'STOREFRONT'
        const row: InAppNotificationDraft = {
          id: randomUUID(),
          eventKey,
          recipientId,
          scope,
          kind,
          requiredRole: workspace ? (adminOnly ? 'ADMIN' : 'STAFF') : 'VERIFIED',
          resourceType,
          resourceId,
          payload: JSON.stringify(payload),
          createdAt: new Date().toISOString(),
        }
        if (await raw.insertInAppNotification(row)) hint({ recipientId, scope })
      }
    }
    async function orderChanged(
      before: OrderRow,
      after: OrderRow,
      context?: { refundOperationId: string },
    ) {
      if (before.paymentStatus !== after.paymentStatus) {
        if (after.paymentStatus === 'PAID') {
          await write(
            'PAYMENT_CONFIRMED',
            `order:${after.id}:PAYMENT_CONFIRMED`,
            'ORDER',
            String(after.id),
            { version: 1, testPayment: after.paymentRequired },
            after.userId,
          )
          pending.push(async () => {
            const final = (await raw.order(after.id))!
            if (
              final.status === 'SUBMITTED' &&
              !final.cancellationIntent &&
              final.paymentStatus === 'PAID'
            )
              await write(
                'NEW_PAID_ORDER',
                `order:${after.id}:NEW_PAID_ORDER`,
                'ORDER',
                String(after.id),
                { version: 1, testPayment: after.paymentRequired },
              )
          })
        }
        if (after.paymentStatus === 'REFUNDED')
          await write(
            'REFUND_COMPLETED',
            `order:${after.id}:REFUND_COMPLETED`,
            'ORDER',
            String(after.id),
            { version: 1, refundPhase: 'COMPLETED', testPayment: after.paymentRequired },
            after.userId,
          )
        if (after.paymentStatus === 'REFUND_FAILED') {
          const episode = context?.refundOperationId ?? after.stripeRefundId
          if (!episode) throw Error('Refund failure requires a persisted operation identity')
          await write(
            'REFUND_FAILED',
            `order:${after.id}:REFUND_FAILED:${episode}`,
            'ORDER',
            String(after.id),
            { version: 1, refundPhase: 'SUPPORT', testPayment: after.paymentRequired },
          )
        }
      }
      if (before.status !== after.status) {
        const kind = (
          {
            PREPARING: 'ORDER_ACCEPTED',
            SHIPPED: 'ORDER_SHIPPED',
            DELIVERED: 'ORDER_DELIVERED',
            CANCELLED: 'ORDER_CANCELLED',
          } as const
        )[after.status as Exclude<OrderRow['status'], 'SUBMITTED'>]
        if (kind)
          pending.push(async () => {
            const final = (await raw.order(after.id))!
            const refundPhase =
              kind === 'ORDER_CANCELLED'
                ? final.paymentStatus === 'REFUNDED'
                  ? 'COMPLETED'
                  : final.paymentStatus === 'REFUND_FAILED'
                    ? 'SUPPORT'
                    : ['PAID', 'REFUND_PENDING'].includes(final.paymentStatus)
                      ? 'PROCESSING'
                      : 'NONE'
                : undefined
            await write(
              kind,
              `order:${after.id}:${kind}`,
              'ORDER',
              String(after.id),
              {
                version: 1,
                testPayment: after.paymentRequired,
                ...(refundPhase ? { refundPhase } : {}),
              },
              after.userId,
            )
          })
      }
    }
    const wrapped: DomainStore = {
      ...raw,
      transaction: (work) => work(wrapped),
      notifyInAppChange: async (h) => {
        hint(h)
      },
      async updateOrder(id, values, expectedStatus, context) {
        const before = await raw.order(id)
        const after = await raw.updateOrder(id, values, expectedStatus)
        if (before && after) await orderChanged(before, after, context)
        return after
      },
      async adjustStock(id, delta) {
        const before = await raw.book(id, true),
          after = await raw.adjustStock(id, delta)
        if (
          before &&
          after &&
          !before.archived &&
          !after.archived &&
          band(before.stock) !== band(after.stock) &&
          band(after.stock) !== 'HEALTHY'
        )
          await write(
            after.stock === 0 ? 'STOCK_OUT' : 'STOCK_LOW',
            `stock:${id}:${randomUUID()}`,
            'BOOK',
            String(id),
            {
              version: 1,
              bookTitle: after.title.slice(0, 256),
              stockAtEvent: after.stock,
              testPayment: false,
            },
          )
        return after
      },
    }
    return wrapped
  }
  const wrapped: DomainStore = {
    ...base,
    async transaction(work) {
      const hints = new Map<string, NotificationHint>(),
        pending: (() => Promise<void>)[] = []
      const result = await base.transaction(async (raw) => {
        const result = await work(scope(raw, hints, pending))
        for (const finish of pending) await finish()
        return result
      })
      await publish(hints)
      return result
    },
    async notifyInAppChange(h) {
      await publish(new Map([[`${h.recipientId}:${h.scope}`, h]]))
    },
    updateOrder: (id, values, expected, context) =>
      wrapped.transaction((tx) => tx.updateOrder(id, values, expected, context)),
    adjustStock: (id, delta) => wrapped.transaction((tx) => tx.adjustStock(id, delta)),
  }
  return wrapped
}
