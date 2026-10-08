import { afterEach, beforeEach, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createDatabase } from '../src/database/connection.js'
import { seedBooks } from '../src/database/seed.js'
import { createPaymentRepository } from '../src/modules/payments/payment.repository.js'
import { createPaymentService } from '../src/modules/payments/payment.service.js'
import { normalizeStore } from '../src/database/persistence.js'
import { FakePaymentProvider } from './fake-payment-provider.js'
import { deliveryAddress, deliveryOptions } from './delivery-fixtures.js'

let db: ReturnType<typeof createDatabase>,
  provider: FakePaymentProvider,
  service: ReturnType<typeof createPaymentService>
let options: {
  provider: FakePaymentProvider
  frontendOrigin: string
  deliveryEnabled: boolean
  deliveryCountryCodes: string[]
  deliveryFeeCents: number
}
const buyer = { id: 'buyer', name: 'Buyer', email: 'buyer@example.com' }
const actor = { source: 'GRAPHQL' as const, userId: 'buyer', name: 'Staff', role: 'STAFF' as const }
const items = [{ bookId: '1', quantity: 1 }]
beforeEach(() => {
  db = createDatabase(':memory:')
  seedBooks(db)
  db.exec("INSERT INTO user(id,name,email) VALUES ('buyer','Buyer','buyer@example.com')")
  provider = new FakePaymentProvider()
  options = {
    ...deliveryOptions,
    deliveryCountryCodes: ['US'],
    provider,
    frontendOrigin: 'http://localhost:5173',
  }
  service = createPaymentService(createPaymentRepository(db, Date.now), options)
})
afterEach(() => db.close())
it('rejects a stale pending cancellation before persisting intent after another processing transition', async () => {
  const placed = await service.createCheckout(
    {
      items,
      deliveryAddress,
      requestKey: randomUUID(),
      expectedDeliveryFeeCents: 500,
      expectedTotalCents: 2199,
    },
    buyer,
  )
  const id = Number(placed.order.id)
  await normalizeStore(db).updateOrder(id, { status: 'PREPARING', paymentStatus: 'PAID' })
  await expect(
    createPaymentRepository(db, Date.now).cancellationIntent(id, {
      input: {
        id: String(id),
        expectedStatus: 'SUBMITTED',
        status: 'CANCELLED',
        cancellationReason: 'No',
      },
      actor,
    }),
  ).rejects.toThrow('status changed')
  expect((await normalizeStore(db).order(id))?.cancellationIntent).toBeNull()
})
it('quotes without writes, detects fee drift and reuses an immutable saved attempt after configuration changes', async () => {
  const quote = await service.quoteCheckout({ items, deliveryAddress })
  expect(quote).toEqual({
    subtotalCents: 1699,
    deliveryFeeCents: 500,
    totalCents: 2199,
    currency: 'usd',
  })
  expect(db.prepare('SELECT count(*) AS n FROM orders').get()).toEqual({ n: 0 })
  expect(provider.sessions.size).toBe(0)
  const input = {
    items,
    deliveryAddress,
    requestKey: randomUUID(),
    expectedDeliveryFeeCents: 500,
    expectedTotalCents: 2199,
  }
  options.deliveryFeeCents = 600
  await expect(service.createCheckout(input, buyer)).rejects.toThrow('Prices changed')
  expect(db.prepare('SELECT stock FROM books WHERE id=1').get()).toEqual({ stock: 12 })
  options.deliveryFeeCents = 500
  const first = await service.createCheckout(input, buyer)
  expect([...provider.sessions.values()][0].amountCents).toBe(2199)
  options.deliveryEnabled = false
  options.deliveryCountryCodes = []
  options.deliveryFeeCents = 900
  const repeated = await service.createCheckout(input, buyer)
  expect(repeated.order).toEqual(first.order)
  await expect(
    service.createCheckout(
      { ...input, deliveryAddress: { ...deliveryAddress, city: 'Other' } },
      buyer,
    ),
  ).rejects.toThrow('Request key')
  await expect(service.quoteCheckout({ items, deliveryAddress })).rejects.toThrow('unavailable')
  expect(db.prepare('SELECT count(*) AS n FROM orders').get()).toEqual({ n: 1 })
})
it('confirms shipment and actual delivery once, prevents changed tracking and post-dispatch cancellation', async () => {
  const placed = await service.createCheckout(
    {
      items,
      deliveryAddress,
      requestKey: randomUUID(),
      expectedDeliveryFeeCents: 500,
      expectedTotalCents: 2199,
    },
    buyer,
  )
  const id = placed.order.id
  provider.pay([...provider.sessions.keys()][0])
  await service.refreshOrderPayment(id, buyer)
  await service.setOrderStatus({ id, expectedStatus: 'SUBMITTED', status: 'PREPARING' }, actor)
  const shipment = {
    carrier: ' Carrier ',
    trackingNumber: ' A1 ',
    trackingUrl: 'https://carrier.example/A1',
  }
  const shipped = await service.setOrderStatus(
    { id, expectedStatus: 'PREPARING', status: 'SHIPPED', shipment },
    actor,
  )
  expect(shipped.delivery?.shipment?.carrier).toBe('Carrier')
  const repeated = await service.setOrderStatus(
    { id, expectedStatus: 'SUBMITTED', status: 'SHIPPED', shipment },
    actor,
  )
  expect(repeated.delivery?.shippedAt).toBe(shipped.delivery?.shippedAt)
  await expect(
    service.setOrderStatus(
      {
        id,
        expectedStatus: 'SHIPPED',
        status: 'SHIPPED',
        shipment: { ...shipment, trackingNumber: 'Different' },
      },
      actor,
    ),
  ).rejects.toThrow('different details')
  await expect(
    service.setOrderStatus(
      { id, expectedStatus: 'SHIPPED', status: 'CANCELLED', cancellationReason: 'No' },
      actor,
    ),
  ).rejects.toThrow('not allowed')
  const delivered = await service.setOrderStatus(
    { id, expectedStatus: 'SHIPPED', status: 'DELIVERED' },
    actor,
  )
  expect(delivered.delivery?.deliveredAt).toBeTruthy()
  await service.setOrderStatus({ id, expectedStatus: 'SHIPPED', status: 'DELIVERED' }, actor)
  expect(db.prepare('SELECT count(*) AS n FROM order_status_events').get()).toEqual({ n: 4 })
  expect(
    db.prepare("SELECT count(*) AS n FROM payment_operations WHERE kind='REFUND'").get(),
  ).toEqual({ n: 0 })
  const activity = JSON.stringify(db.prepare('SELECT * FROM activity_events').all())
  expect(activity).not.toContain(deliveryAddress.phone)
  expect(activity).not.toContain('carrier.example')
})
it('omits free delivery provider line and restores fulfillment state if delivery persistence fails', async () => {
  options.deliveryFeeCents = 0
  let lines: { title: string }[] = []
  const create = provider.createSession.bind(provider)
  provider.createSession = async (input, key) => {
    lines = input.lines
    return create(input, key)
  }
  const placed = await service.createCheckout(
    {
      items,
      deliveryAddress,
      requestKey: randomUUID(),
      expectedDeliveryFeeCents: 0,
      expectedTotalCents: 1699,
    },
    buyer,
  )
  expect(lines.map((line) => line.title)).not.toContain('Delivery')
  const id = placed.order.id
  provider.pay([...provider.sessions.keys()][0])
  await service.refreshOrderPayment(id, buyer)
  await service.setOrderStatus({ id, expectedStatus: 'SUBMITTED', status: 'PREPARING' }, actor)
  db.exec(
    "CREATE TRIGGER fail_delivery BEFORE UPDATE ON order_deliveries BEGIN SELECT RAISE(ABORT,'delivery failed'); END",
  )
  await expect(
    service.setOrderStatus({ id, expectedStatus: 'PREPARING', status: 'SHIPPED' }, actor),
  ).rejects.toThrow('delivery failed')
  expect((await service.readOrder(id, buyer)).status).toBe('PREPARING')
  expect(db.prepare('SELECT shipped_at FROM order_deliveries').get()).toEqual({ shipped_at: null })
  expect(db.prepare('SELECT count(*) AS n FROM order_status_events').get()).toEqual({ n: 2 })
})
