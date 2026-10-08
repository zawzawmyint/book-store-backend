import { afterEach, expect, it } from 'vitest'
import { createDatabase } from '../src/database/connection.js'
import { seedBooks } from '../src/database/seed.js'
import { createPaymentRepository } from '../src/modules/payments/payment.repository.js'
import { createPaymentService } from '../src/modules/payments/payment.service.js'
import { FakePaymentProvider } from './fake-payment-provider.js'
import { deliveryAddress, deliveryOptions } from './delivery-fixtures.js'
import type Database from 'better-sqlite3'

const databases: Database.Database[] = []
afterEach(() => databases.splice(0).forEach((db) => db.close()))
const buyer = { id: 'buyer', name: 'Buyer', email: 'buyer@example.com' }
const actor = { source: 'GRAPHQL' as const, userId: 'buyer', name: 'Staff', role: 'STAFF' as const }
const input = {
  requestKey: '00000000-0000-4000-8000-000000000001',
  items: [{ bookId: '1', quantity: 1 }],
  deliveryAddress,
  expectedDeliveryFeeCents: 500,
  expectedTotalCents: 2199,
}
function fresh(provider: FakePaymentProvider, clock: () => number) {
  const db = createDatabase(':memory:')
  databases.push(db)
  seedBooks(db)
  db.exec("INSERT INTO user(id,name,email) VALUES ('buyer','Buyer','buyer@example.com')")
  const service = () =>
    createPaymentService(createPaymentRepository(db, clock), {
      provider,
      now: clock,
      ...deliveryOptions,
      frontendOrigin: 'http://localhost:5173',
    })
  return { db, service }
}
it('does not reuse checkout or refund keys when independent databases reuse order IDs', async () => {
  const provider = new FakePaymentProvider()
  for (let count = 0; count < 2; count++) {
    const { service } = fresh(provider, Date.now)
    const api = service()
    const checkout = await api.createCheckout(input, buyer)
    expect(checkout.order.id).toBe('1')
    const sessionId = [...provider.sessions.keys()].at(-1)!
    provider.pay(sessionId)
    await api.refreshOrderPayment('1', buyer)
    await api.setOrderStatus(
      {
        id: '1',
        expectedStatus: 'SUBMITTED',
        status: 'CANCELLED',
        cancellationReason: 'Requested cancellation',
      },
      actor,
    )
    await api.recover()
  }
  expect(provider.sessionKeys.size).toBe(2)
  expect(provider.refundKeys.size).toBe(2)
  for (const key of provider.sessionKeys.keys()) expect(key).toMatch(/^checkout:[0-9a-f-]{36}$/)
  for (const key of provider.refundKeys.keys()) expect(key).toMatch(/^refund:[0-9a-f-]{36}$/)
})
it('reuses the persisted key after a lost response and service restart', async () => {
  const provider = new FakePaymentProvider()
  let now = Date.now()
  const { db, service } = fresh(provider, () => now)
  provider.uncertainCreate = true
  await expect(service().createCheckout(input, buyer)).rejects.toThrow('unavailable')
  const saved = db.prepare('SELECT id FROM payment_operations').get()
  now += 61000
  await service().recover()
  const recovered = await service().createCheckout(input, buyer)
  expect(recovered.checkoutUrl).toBeTruthy()
  expect(db.prepare('SELECT id FROM payment_operations').get()).toEqual(saved)
  expect(provider.sessions.size).toBe(1)
})
it('recovers an existing deterministic key without replacing it', async () => {
  const provider = new FakePaymentProvider()
  provider.unavailable = true
  let now = Date.now()
  const { db, service } = fresh(provider, () => now)
  await expect(service().createCheckout(input, buyer)).rejects.toThrow('unavailable')
  db.prepare('UPDATE payment_operations SET id=?').run('checkout:1')
  provider.unavailable = false
  now += 61000
  await service().recover()
  expect((await service().resumeCheckout('1', buyer)).checkoutUrl).toBeTruthy()
  expect(provider.sessionKeys.has('checkout:1')).toBe(true)
})
