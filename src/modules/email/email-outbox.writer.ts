import { randomUUID } from 'node:crypto'
import { normalizeStore, type DatabaseInput } from '../../database/persistence.js'
import type { DomainStore } from '../../database/store.types.js'
import type { EmailCrypto } from './email-payload.crypto.js'
import type { EmailPayload, NotificationKind } from './email-notification.types.js'

export type AuthEmailInput = {
  kind: 'VERIFY_EMAIL' | 'RESET_PASSWORD'
  userId: string
  to: string
  url: string
  token: string
}
export type OrderEmailWriter = (
  tx: DomainStore,
  orderId: number,
  kind: Extract<NotificationKind, `ORDER_${string}`>,
) => Promise<string | null>

export function createEmailOutboxWriter(
  input: DatabaseInput,
  crypto: EmailCrypto,
  clock = Date.now,
) {
  const store = normalizeStore(input)
  async function enqueueAuthEmail(input: AuthEmailInput) {
    let expiresAt: number | undefined
    if (input.kind === 'VERIFY_EMAIL') {
      const payload = JSON.parse(
        Buffer.from(input.token.split('.')[1], 'base64url').toString('utf8'),
      ) as { exp?: number }
      if (typeof payload.exp === 'number') expiresAt = payload.exp * 1000
    } else expiresAt = await store.emailResetExpiry(input.token)
    if (!expiresAt || !Number.isSafeInteger(expiresAt))
      throw new Error('EMAIL_TOKEN_EXPIRY_UNAVAILABLE')
    const dedupeKey = crypto.digest(JSON.stringify([input.kind, input.to, input.url]))
    const id = randomUUID()
    const payload: EmailPayload = {
      to: input.to,
      url: input.url,
      ...(input.kind === 'RESET_PASSWORD' ? { resetToken: input.token } : {}),
    }
    await store.insertEmailNotification({
      id,
      dedupeKey,
      kind: input.kind,
      queue: 'AUTH',
      userId: input.userId,
      createdAt: clock(),
      nextAttemptAt: clock(),
      expiresAt,
      ...crypto.seal(id, input.kind, payload),
    })
    return (await store.emailByDedupe(dedupeKey))!.id
  }
  const writeOrderEmail: OrderEmailWriter = async (tx, orderId, kind) => {
    const row = await tx.order(orderId)
    if (!row || !row.paymentRequired) return null
    const dedupeKey = crypto.digest(JSON.stringify([orderId, kind]))
    const existing = await tx.emailByDedupe(dedupeKey)
    if (existing) return existing.id
    const delivery = await tx.delivery(orderId)
    const history = await tx.history(orderId)
    const payload: EmailPayload = {
      to: row.email,
      order: {
        id: row.id,
        customerName: row.customerName,
        items: (await tx.lines([orderId])).map(({ title, quantity, unitPriceCents }) => ({
          title,
          quantity,
          unitPriceCents,
        })),
        subtotalCents: row.subtotalCents,
        deliveryFeeCents: row.deliveryFeeCents,
        totalCents: row.totalCents,
        currency: row.currency,
        eventAt: new Date(clock()).toISOString(),
        testPayment: true,
        ...(delivery
          ? {
              address: {
                recipientName: delivery.recipientName,
                line1: delivery.addressLine1,
                line2: delivery.addressLine2,
                city: delivery.city,
                region: delivery.region,
                postalCode: delivery.postalCode,
                countryCode: delivery.countryCode,
              },
              carrier: delivery.carrier,
              trackingNumber: delivery.trackingNumber,
              trackingUrl: delivery.trackingUrl,
            }
          : {}),
        cancellationReason: history.find((h) => h.toStatus === 'CANCELLED')?.cancellationReason,
        refundStatus:
          row.paymentStatus === 'REFUNDED'
            ? 'REFUNDED'
            : row.paymentStatus === 'REFUND_FAILED'
              ? 'SUPPORT'
              : 'PENDING',
      },
    }
    const id = randomUUID()
    await tx.insertEmailNotification({
      id,
      dedupeKey,
      kind,
      queue: 'ORDER',
      orderId,
      userId: row.userId,
      sequence: await tx.emailOrderSequence(orderId),
      createdAt: clock(),
      nextAttemptAt: clock(),
      ...crypto.seal(id, kind, payload),
    })
    return (await tx.emailByDedupe(dedupeKey))!.id
  }
  return { enqueueAuthEmail, writeOrderEmail }
}
