import { expect, it } from 'vitest'
import { renderNotification } from '../src/modules/email/email.templates.js'
import { authEmail } from '../src/modules/email/email.content.js'
import type {
  EmailPayload,
  NotificationKind,
} from '../src/modules/email/email-notification.types.js'

const payload: EmailPayload = {
  to: 'reader@example.com',
  order: {
    id: 42,
    customerName: '<Reader>',
    items: [{ title: '<Book>', quantity: 2, unitPriceCents: 1250 }],
    subtotalCents: 2500,
    deliveryFeeCents: 300,
    totalCents: 2800,
    currency: 'usd',
    eventAt: '2026-10-16T12:00:00Z',
    testPayment: true,
    cancellationReason: '<Reason>',
    refundStatus: 'PENDING',
  },
}
it('preserves existing auth content and supplied links', () => {
  for (const [kind, authKind] of [
    ['VERIFY_EMAIL', 'verify'],
    ['RESET_PASSWORD', 'reset'],
  ] as const)
    expect(
      renderNotification(
        kind,
        { to: payload.to, url: 'https://books.example/supplied-token' },
        'https://books.example',
      ),
    ).toEqual(authEmail(payload.to, 'https://books.example/supplied-token', authKind))
})
it('renders escaped immutable order content, money, test label and trusted account link', () => {
  const message = renderNotification('ORDER_CONFIRMED', payload, 'https://books.example')
  expect(message.subject).toContain('Payment received')
  expect(message.text).toContain('awaiting order acceptance')
  expect(message.html).toContain('awaiting order acceptance')
  expect(message.subject).not.toContain('Order confirmed')
  expect(message.text).toContain('$28.00')
  expect(message.text).toContain('Test payment')
  expect(message.html).toContain('&lt;Book&gt;')
  expect(message.html).not.toContain('<Reader>')
  expect(message.html).toContain('https://books.example/account/orders/42')
  expect(() => renderNotification('ORDER_CONFIRMED', payload, 'javascript:alert(1)')).toThrow()
})
it('renders preparation acceptance separately from the payment receipt', () => {
  const message = renderNotification('ORDER_ACCEPTED', payload, 'https://books.example')
  expect(message.subject).toContain('Order accepted')
  expect(message.text).toContain('preparing your books')
  expect(message.html).toContain('preparing your books')
  expect(message.text).not.toContain('awaiting order acceptance')
})
it('rejects unknown persisted notification kinds instead of rendering malformed email', () => {
  expect(() =>
    renderNotification('FUTURE_EVENT' as NotificationKind, payload, 'https://books.example'),
  ).toThrow('EMAIL_NOTIFICATION_KIND_UNSUPPORTED')
})
it('distinguishes cancellation from successful refund and rejects unsafe tracking URLs', () => {
  expect(renderNotification('ORDER_CANCELLED', payload, 'https://books.example').text).toContain(
    'refund is pending',
  )
  expect(renderNotification('ORDER_REFUNDED', payload, 'https://books.example').text).toContain(
    'refund has been confirmed',
  )
  expect(() =>
    renderNotification(
      'ORDER_SHIPPED',
      { ...payload, order: { ...payload.order!, trackingUrl: 'javascript:alert(1)' } },
      'https://books.example',
    ),
  ).toThrow('EMAIL_TRACKING_URL_INVALID')
})
it('enforces the shipment HTTPS and tracking-number contract in email links', () => {
  for (const trackingUrl of [
    'http://carrier.example/track',
    'https://user:password@carrier.example/track',
    'https://carrier.example/track',
  ]) {
    expect(() =>
      renderNotification(
        'ORDER_SHIPPED',
        { ...payload, order: { ...payload.order!, trackingUrl } },
        'https://books.example',
      ),
    ).toThrow('EMAIL_TRACKING_URL_INVALID')
  }
  const message = renderNotification(
    'ORDER_SHIPPED',
    {
      ...payload,
      order: {
        ...payload.order!,
        trackingUrl: 'https://carrier.example/track',
        trackingNumber: '123',
        carrier: 'Carrier',
      },
    },
    'https://books.example',
  )
  expect(message.html).toContain('href="https://carrier.example/track"')
})

it('gives verification and reset a branded heading, prominent action and copyable exact fallback URL', () => {
  const url = 'https://books.example/api/auth/action?token=secret&callbackURL=%2Faccount'
  for (const kind of ['verify', 'reset'] as const) {
    const message = authEmail('reader@example.com', url, kind)
    expect(message.html).toContain('<h1')
    expect(message.html).toContain('The Quiet Shelf')
    expect(message.html).toContain('If the button')
    expect(message.html).toContain(
      'href="https://books.example/api/auth/action?token=secret&amp;callbackURL=%2Faccount"',
    )
    expect(message.text).toContain(url)
    expect(message.text).toContain('one hour')
    expect(message.html).not.toContain('<script')
  }
})

it.each([
  'ORDER_CONFIRMED',
  'ORDER_ACCEPTED',
  'ORDER_SHIPPED',
  'ORDER_CANCELLED',
  'ORDER_REFUNDED',
] as const)('renders %s with readable date and a structured escaped order summary', (kind) => {
  const message = renderNotification(kind, payload, 'https://books.example')
  expect(message.html).toContain('<th')
  expect(message.html).toContain('Order summary')
  expect(message.html).toContain('&lt;Reader&gt;')
  expect(message.html).toContain('&lt;Book&gt;')
  expect(message.html).not.toContain('2026-10-16T12:00:00Z')
  expect(message.text).toContain('UTC')
  expect(message.text).toContain('$28.00')
  expect(message.html).toContain('View your order')
})
