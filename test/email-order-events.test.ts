import { afterEach, beforeEach, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createDatabase } from '../src/database/connection.js'
import { seedBooks } from '../src/database/seed.js'
import { normalizeStore } from '../src/database/persistence.js'
import { createPaymentRepository } from '../src/modules/payments/payment.repository.js'
import { createPaymentService } from '../src/modules/payments/payment.service.js'
import { createEmailCrypto } from '../src/modules/email/email-payload.crypto.js'
import { createEmailOutboxWriter } from '../src/modules/email/email-outbox.writer.js'
import { FakePaymentProvider } from './fake-payment-provider.js'
import { deliveryAddress, deliveryOptions } from './delivery-fixtures.js'

let db: ReturnType<typeof createDatabase>
let provider: FakePaymentProvider
let service: ReturnType<typeof createPaymentService>
const crypto = createEmailCrypto({
  keys: { v1: Buffer.alloc(32, 7).toString('base64') },
  activeKeyId: 'v1',
})
const buyer = { id: 'buyer', name: 'Buyer', email: 'buyer@example.com' }
const actor = { source: 'GRAPHQL' as const, userId: 'buyer', name: 'Staff', role: 'STAFF' as const }
beforeEach(() => {
  db = createDatabase(':memory:')
  seedBooks(db)
  db.exec("INSERT INTO user(id,name,email) VALUES ('buyer','Buyer','buyer@example.com')")
  provider = new FakePaymentProvider()
  service = createPaymentService(
    createPaymentRepository(db, Date.now, createEmailOutboxWriter(db, crypto).writeOrderEmail),
    { ...deliveryOptions, provider, frontendOrigin: 'http://localhost:5173' },
  )
})
afterEach(() => db.close())
async function checkout() {
  return service.createCheckout(
    {
      items: [{ bookId: '1', quantity: 1 }],
      deliveryAddress,
      requestKey: randomUUID(),
      expectedDeliveryFeeCents: 500,
      expectedTotalCents: 2199,
    },
    buyer,
  )
}
const kinds = () =>
  (
    db.prepare('SELECT kind FROM email_notifications ORDER BY sequence').all() as { kind: string }[]
  ).map((r) => r.kind)

it('records payment receipt, acceptance and shipment once at their committed transitions', async () => {
  const placed = await checkout()
  const id = placed.order.id
  expect(kinds()).toEqual([])
  provider.pay([...provider.sessions.keys()][0])
  await service.refreshOrderPayment(id, buyer)
  await service.refreshOrderPayment(id, buyer)
  expect(kinds()).toEqual(['ORDER_CONFIRMED'])
  expect((await normalizeStore(db).order(Number(id)))?.status).toBe('SUBMITTED')
  await service.setOrderStatus({ id, expectedStatus: 'SUBMITTED', status: 'PREPARING' }, actor)
  await service.setOrderStatus({ id, expectedStatus: 'SUBMITTED', status: 'PREPARING' }, actor)
  expect(kinds()).toEqual(['ORDER_CONFIRMED', 'ORDER_ACCEPTED'])
  const shipment = {
    carrier: 'Carrier',
    trackingNumber: 'T1',
    trackingUrl: 'https://carrier.example/T1',
  }
  await service.setOrderStatus(
    { id, expectedStatus: 'PREPARING', status: 'SHIPPED', shipment },
    actor,
  )
  await service.setOrderStatus(
    { id, expectedStatus: 'SHIPPED', status: 'SHIPPED', shipment },
    actor,
  )
  expect(kinds()).toEqual(['ORDER_CONFIRMED', 'ORDER_ACCEPTED', 'ORDER_SHIPPED'])
  const rows = await normalizeStore(db).dueEmailNotifications(Date.now(), 50)
  expect(crypto.open(rows.find((r) => r.kind === 'ORDER_CONFIRMED')!).order?.totalCents).toBe(2199)
  expect(crypto.open(rows.find((r) => r.kind === 'ORDER_SHIPPED')!).order?.trackingNumber).toBe(
    'T1',
  )
  expect(
    await normalizeStore(db).claimEmailSend(
      rows.find((r) => r.kind === 'ORDER_SHIPPED')!.id,
      Date.now(),
      randomUUID(),
    ),
  ).toBeUndefined()
})

it('does not record acceptance for unpaid preparation and rolls back a failed acceptance insert', async () => {
  const placed = await checkout()
  const input = {
    id: placed.order.id,
    expectedStatus: 'SUBMITTED' as const,
    status: 'PREPARING' as const,
  }
  await expect(service.setOrderStatus(input, actor)).rejects.toThrow()
  expect(kinds()).toEqual([])
  provider.pay([...provider.sessions.keys()][0])
  await service.refreshOrderPayment(input.id, buyer)
  const historyBefore = await normalizeStore(db).history(Number(input.id))
  db.exec(
    "CREATE TRIGGER fail_acceptance BEFORE INSERT ON email_notifications WHEN NEW.kind='ORDER_ACCEPTED' BEGIN SELECT RAISE(ABORT,'outbox unavailable'); END",
  )
  await expect(service.setOrderStatus(input, actor)).rejects.toThrow('outbox unavailable')
  expect((await normalizeStore(db).order(Number(input.id)))?.status).toBe('SUBMITTED')
  expect(await normalizeStore(db).history(Number(input.id))).toEqual(historyBefore)
  expect(kinds()).toEqual(['ORDER_CONFIRMED'])
})

it('records cancellation separately from a confirmed refund and suppresses unpaid expiry', async () => {
  const placed = await checkout()
  const id = placed.order.id
  provider.pay([...provider.sessions.keys()][0])
  await service.refreshOrderPayment(id, buyer)
  await service.setOrderStatus(
    {
      id,
      expectedStatus: 'SUBMITTED',
      status: 'CANCELLED',
      cancellationReason: 'Requested cancellation',
    },
    actor,
  )
  expect(kinds()).toEqual(['ORDER_CONFIRMED', 'ORDER_CANCELLED'])
  await service.recover()
  expect(kinds()).toEqual(['ORDER_CONFIRMED', 'ORDER_CANCELLED', 'ORDER_REFUNDED'])
  const unpaid = await checkout()
  await service.setOrderStatus(
    {
      id: unpaid.order.id,
      expectedStatus: 'SUBMITTED',
      status: 'CANCELLED',
      cancellationReason: 'Abandoned',
    },
    actor,
  )
  expect(kinds()).toHaveLength(3)
})

it('rolls back payment state when durable notification insertion fails', async () => {
  const placed = await checkout()
  provider.pay([...provider.sessions.keys()][0])
  db.exec(
    "CREATE TRIGGER fail_email BEFORE INSERT ON email_notifications BEGIN SELECT RAISE(ABORT,'outbox unavailable'); END",
  )
  await expect(service.refreshOrderPayment(placed.order.id, buyer)).rejects.toThrow()
  expect((await normalizeStore(db).order(Number(placed.order.id)))?.paymentStatus).toBe('PENDING')
})

it('handles a late successful payment after cancellation without purchase confirmation', async () => {
  const placed = await checkout()
  const id = placed.order.id
  await service.setOrderStatus(
    {
      id,
      expectedStatus: 'SUBMITTED',
      status: 'CANCELLED',
      cancellationReason: 'Cancelled before payment',
    },
    actor,
  )
  expect(kinds()).toEqual([])
  provider.pay([...provider.sessions.keys()][0])
  await service.refreshOrderPayment(id, buyer)
  expect(kinds()).toEqual(['ORDER_CANCELLED'])
  await service.recover()
  expect(kinds()).toEqual(['ORDER_CANCELLED', 'ORDER_REFUNDED'])
})
