import { authEmail } from './email.content.js'
import type { EmailPayload, NotificationKind } from './email-notification.types.js'
import type { EmailMessage } from './email.service.js'

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
export function renderNotification(
  kind: NotificationKind,
  payload: EmailPayload,
  frontendOrigin: string,
): EmailMessage {
  if (kind === 'VERIFY_EMAIL' || kind === 'RESET_PASSWORD') {
    if (!payload.url) throw new Error('EMAIL_AUTH_URL_MISSING')
    return authEmail(payload.to, payload.url, kind === 'VERIFY_EMAIL' ? 'verify' : 'reset')
  }
  const order = payload.order
  if (!order) throw new Error('EMAIL_ORDER_SNAPSHOT_MISSING')
  const origin = new URL(frontendOrigin)
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== frontendOrigin)
    throw new Error('EMAIL_FRONTEND_ORIGIN_INVALID')
  if (!Number.isSafeInteger(order.id) || order.id < 1 || order.currency.toLowerCase() !== 'usd')
    throw new Error('EMAIL_ORDER_SNAPSHOT_INVALID')
  const money = (cents: number) => {
    if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('EMAIL_ORDER_AMOUNT_INVALID')
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
      cents / 100,
    )
  }
  const action = {
    ORDER_CONFIRMED: 'Order confirmed',
    ORDER_SHIPPED: 'Order shipped',
    ORDER_CANCELLED: 'Order cancelled',
    ORDER_REFUNDED: 'Order refunded',
  }[kind]
  const lines = [
    `Hello ${order.customerName},`,
    `${action}: #${order.id}`,
    ...(order.testPayment ? ['Test payment — no live payment was collected.'] : []),
    `Event: ${order.eventAt}`,
    ...order.items.map(
      (item) => `${item.quantity} × ${item.title} — ${money(item.unitPriceCents)} each`,
    ),
    `Subtotal: ${money(order.subtotalCents)}`,
    `Delivery: ${money(order.deliveryFeeCents)}`,
    `Total: ${money(order.totalCents)}`,
  ]
  if (order.address)
    lines.push(
      'Delivery address:',
      ...[
        order.address.recipientName,
        order.address.line1,
        order.address.line2,
        order.address.city,
        order.address.region,
        order.address.postalCode,
        order.address.countryCode,
      ].filter((value): value is string => !!value),
    )
  if (kind === 'ORDER_CANCELLED') {
    if (order.cancellationReason) lines.push(`Reason: ${order.cancellationReason}`)
    lines.push(
      order.refundStatus === 'REFUNDED'
        ? 'Your refund has already been confirmed.'
        : order.refundStatus === 'PENDING'
          ? 'Your refund is pending. Cancellation does not confirm a completed refund.'
          : 'Please contact support about your refund.',
    )
  }
  if (kind === 'ORDER_REFUNDED')
    lines.push(
      `Your full refund has been confirmed: ${money(order.totalCents)}. Your bank may take additional time to post it.`,
    )
  let trackingUrl: string | undefined
  if (kind === 'ORDER_SHIPPED') {
    if (order.carrier) lines.push(`Carrier: ${order.carrier}`)
    if (order.trackingNumber) lines.push(`Tracking number: ${order.trackingNumber}`)
    if (order.trackingUrl) {
      const parsed = new URL(order.trackingUrl)
      if (
        parsed.protocol !== 'https:' ||
        !order.trackingNumber ||
        !order.carrier ||
        parsed.username ||
        parsed.password
      )
        throw new Error('EMAIL_TRACKING_URL_INVALID')
      trackingUrl = parsed.toString()
      lines.push(`Track shipment: ${trackingUrl}`)
    }
  }
  const orderUrl = `${frontendOrigin}/account/orders/${order.id}`
  lines.push(`View your order: ${orderUrl}`)
  return {
    to: payload.to,
    subject: `${action} #${order.id} — The Quiet Shelf`,
    text: lines.join('\n'),
    html: `<main><h1>The Quiet Shelf</h1>${lines
      .filter((line) => !line.startsWith('View your order:') && !line.startsWith('Track shipment:'))
      .map((line) => `<p>${escape(line)}</p>`)
      .join(
        '',
      )}${trackingUrl ? `<p><a href="${escape(trackingUrl)}">Track shipment</a></p>` : ''}<p><a href="${escape(orderUrl)}">View your order</a></p></main>`,
  }
}
