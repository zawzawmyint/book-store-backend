import { authEmail } from './email.content.js'
import type { EmailPayload, NotificationKind } from './email-notification.types.js'
import type { EmailMessage } from './email.service.js'
import {
  emailLayout,
  emailButton,
  emailParagraph,
  escapeEmailHtml as escape,
} from './email.layout.js'
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
    // Retain the persisted kind for existing encrypted payloads and dedupe keys.
    ORDER_CONFIRMED: 'Payment received — awaiting order acceptance',
    ORDER_ACCEPTED: 'Order accepted — preparing your books',
    ORDER_SHIPPED: 'Order shipped',
    ORDER_CANCELLED: 'Order cancelled',
    ORDER_REFUNDED: 'Order refunded',
  }[kind]
  if (typeof action !== 'string') throw new Error('EMAIL_NOTIFICATION_KIND_UNSUPPORTED')
  const title = {
    ORDER_CONFIRMED: 'Payment received',
    ORDER_ACCEPTED: 'Your books are being prepared',
    ORDER_SHIPPED: 'Your books are on their way',
    ORDER_CANCELLED: 'Your order has been cancelled',
    ORDER_REFUNDED: 'Your refund is confirmed',
  }[kind]
  const intro = {
    ORDER_CONFIRMED:
      'Thank you for your order. We have received your payment and are awaiting order acceptance. We will email you again when our team accepts your order.',
    ORDER_ACCEPTED:
      'We have accepted your order and are preparing your books. We will let you know when they are on their way.',
    ORDER_SHIPPED:
      'Your order has been shipped. You can review your order below and follow its progress when tracking is available.',
    ORDER_CANCELLED:
      'Your order has been cancelled. You can find the cancellation and refund details below.',
    ORDER_REFUNDED:
      'Your refund has been processed. The confirmed amount and original order details are below.',
  }[kind]
  const eventDate = new Date(order.eventAt)
  if (!Number.isFinite(eventDate.getTime())) throw new Error('EMAIL_ORDER_DATE_INVALID')
  const date =
    new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(eventDate) + ' UTC'
  const addressLines = order.address
    ? [
        order.address.recipientName,
        order.address.line1,
        order.address.line2,
        order.address.city,
        order.address.region,
        order.address.postalCode,
        order.address.countryCode,
      ].filter((value): value is string => !!value)
    : []
  const lines = [
    `Hello ${order.customerName},`,
    `${action}: #${order.id}`,
    intro,
    ...(order.testPayment ? ['Test payment — no live payment was collected.'] : []),
    `Date: ${date}`,
    ...order.items.map(
      (item) => `${item.quantity} × ${item.title} — ${money(item.unitPriceCents)} each`,
    ),
    `Subtotal: ${money(order.subtotalCents)}`,
    `Delivery: ${money(order.deliveryFeeCents)}`,
    `Total: ${money(order.totalCents)}`,
  ]
  if (addressLines.length) lines.push('Delivery address:', ...addressLines)
  const details: string[] = []
  if (kind === 'ORDER_CANCELLED') {
    if (order.cancellationReason) details.push(`Reason: ${order.cancellationReason}`)
    details.push(
      order.refundStatus === 'REFUNDED'
        ? 'Your refund has already been confirmed.'
        : order.refundStatus === 'PENDING'
          ? 'Your refund is pending. Cancellation does not confirm a completed refund.'
          : 'Please contact support about your refund.',
    )
  }
  if (kind === 'ORDER_REFUNDED')
    details.push(
      `Your full refund has been confirmed: ${money(order.totalCents)}. Your bank may take additional time to post it.`,
    )
  let trackingUrl: string | undefined
  if (kind === 'ORDER_SHIPPED') {
    if (order.carrier) details.push(`Carrier: ${order.carrier}`)
    if (order.trackingNumber) details.push(`Tracking number: ${order.trackingNumber}`)
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
    }
  }
  const orderUrl = `${frontendOrigin}/account/orders/${order.id}`
  lines.push(...details)
  if (trackingUrl) lines.push(`Track shipment: ${trackingUrl}`)
  lines.push(`View your order: ${orderUrl}`)
  const cellStyle =
    'padding:14px 0;border-bottom:1px solid #e2e5dc;vertical-align:top;font-size:14px;line-height:1.5;'
  const totalRow = (label: string, value: number, strong = false) =>
    `<tr><td colspan="2" style="padding:8px 0;${strong ? 'font-weight:bold;font-size:18px;border-top:1px solid #e2e5dc;' : 'font-size:14px;color:#626d65;'}">${label}</td><td align="right" style="padding:8px 0;white-space:nowrap;${strong ? 'font-weight:bold;font-size:18px;border-top:1px solid #e2e5dc;' : 'font-size:14px;'}">${money(value)}</td></tr>`
  return {
    to: payload.to,
    subject: `${action} #${order.id} — The Quiet Shelf`,
    text: lines.join('\n'),
    html: emailLayout({
      title,
      eyebrow: `Order #${order.id}`,
      preheader: `${action}. Order #${order.id} from The Quiet Shelf.`,
      body: `${emailParagraph(`Hello ${order.customerName},`)}${emailParagraph(intro)}
${order.testPayment ? '<p style="margin:0 0 20px;padding:10px 12px;background-color:#f7f5f0;border:1px solid #e2e5dc;border-radius:4px;color:#626d65;font-size:12px;line-height:18px;">Test payment — no live payment was collected.</p>' : ''}
${details.map(emailParagraph).join('')}
${emailButton(trackingUrl ? 'Track shipment' : 'View your order', trackingUrl ?? orderUrl)}
${trackingUrl ? `<p style="margin:0 0 24px;font-size:14px;"><a href="${escape(orderUrl)}" style="color:#2b5843;text-decoration:underline;">View your order</a></p>` : ''}
<h2 style="margin:28px 0 6px;font-family:Georgia,'Times New Roman',serif;font-size:21px;font-weight:normal;">Order summary</h2>
<p style="margin:0 0 16px;color:#626d65;font-size:12px;line-height:18px;">Order #${order.id} · ${escape(date)}</p>
<table width="100%" cellpadding="0" cellspacing="0" border="0" aria-label="Order summary" style="table-layout:fixed;border-collapse:collapse;">
<thead><tr><th scope="col" align="left" width="55%" style="${cellStyle}color:#626d65;">Book</th><th scope="col" align="center" width="15%" style="${cellStyle}color:#626d65;">Qty</th><th scope="col" align="right" width="30%" style="${cellStyle}color:#626d65;">Amount</th></tr></thead>
<tbody>${order.items.map((item) => `<tr><td style="${cellStyle}padding-right:12px;">${escape(item.title)}<br><span style="font-size:12px;color:#626d65;">${money(item.unitPriceCents)} each</span></td><td align="center" style="${cellStyle}">${item.quantity}</td><td align="right" style="${cellStyle}white-space:nowrap;">${money(item.unitPriceCents * item.quantity)}</td></tr>`).join('')}</tbody>
<tfoot>${totalRow('Subtotal', order.subtotalCents)}${totalRow('Delivery', order.deliveryFeeCents)}${totalRow('Total', order.totalCents, true)}</tfoot></table>
${addressLines.length ? `<div style="margin-top:24px;padding:18px;background-color:#f7f5f0;border-radius:6px;"><h2 style="margin:0 0 10px;font-size:14px;font-weight:bold;">Delivery address</h2><p style="margin:0;font-size:14px;line-height:1.65;">${addressLines.map(escape).join('<br>')}</p></div>` : ''}`,
    }),
  }
}
