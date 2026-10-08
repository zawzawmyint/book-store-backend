import { deliveryAddress, deliveryOptions } from './delivery-fixtures.js'
import { createPaymentRepository } from '../src/modules/payments/payment.repository.js'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { createDatabase } from '../src/database/connection.js'
import { seedBooks } from '../src/database/seed.js'
import { createPaymentService } from '../src/modules/payments/payment.service.js'
import { createAdminOrderRepository } from '../src/modules/orders/admin-order.repository.js'
import { FakePaymentProvider } from './fake-payment-provider.js'
import { ProviderRejection } from '../src/modules/payments/payment.provider.js'
import { randomUUID } from 'node:crypto'
let db: Database.Database,
  provider: FakePaymentProvider,
  service: ReturnType<typeof createPaymentService>,
  now: number
const buyer = {
  id: 'buyer',
  name: 'Buyer',
  email: 'buyer@example.com',
}
const actor = {
  source: 'GRAPHQL' as const,
  userId: 'buyer',
  name: 'Staff',
  role: 'STAFF' as const,
}
const input = {
  deliveryAddress,
  expectedDeliveryFeeCents: 500,
  expectedTotalCents: 3898,
  requestKey: '00000000-0000-4000-8000-000000000001',
  items: [
    {
      bookId: '1',
      quantity: 2,
    },
  ],
}
beforeEach(() => {
  db = createDatabase(':memory:')
  seedBooks(db)
  db.exec("INSERT INTO user(id,name,email) VALUES ('buyer','Buyer','buyer@example.com')")
  provider = new FakePaymentProvider()
  now = Date.now()
  service = createPaymentService(
    createPaymentRepository(db, () => now),
    {
      provider,
      now: () => now,
      ...deliveryOptions,
      frontendOrigin: 'http://localhost:5173',
    },
  )
})
afterEach(() => db.close())
it('builds return URLs only from configured origin and local order ID', async () => {
  let urls:
    | {
        successUrl: string
        cancelUrl: string
      }
    | undefined
  const create = provider.createSession.bind(provider)
  provider.createSession = async (input, key) => {
    urls = input
    return create(input, key)
  }
  const c = await service.createCheckout(input, buyer)
  expect(urls?.successUrl).toBe(
    `http://localhost:5173/checkout/return/${c.order.id}?outcome=success`,
  )
  expect(urls?.cancelUrl).toBe(`http://localhost:5173/checkout/return/${c.order.id}?outcome=cancel`)
})
it('reserves saved totals once across concurrent keys, lost responses and restart recovery', async () => {
  const stock = db.prepare('SELECT stock FROM books WHERE id=1').get() as {
    stock: number
  }
  provider.uncertainCreate = true
  await expect(service.createCheckout(input, buyer)).rejects.toThrow('unavailable')
  expect(provider.sessions.size).toBe(1)
  now += 61000
  service = createPaymentService(
    createPaymentRepository(db, () => now),
    {
      provider,
      now: () => now,
      ...deliveryOptions,
      frontendOrigin: 'http://localhost:5173',
    },
  )
  await service.recover()
  const [a, b] = await Promise.all([
    service.createCheckout(input, buyer),
    service.createCheckout(input, buyer),
  ])
  expect(a.order.id).toBe(b.order.id)
  expect(a.checkoutUrl).toBe(b.checkoutUrl)
  expect(db.prepare('SELECT stock FROM books WHERE id=1').get()).toEqual({
    stock: stock.stock - 2,
  })
  expect(a.order.payment).toMatchObject({
    required: true,
    status: 'PENDING',
    currency: 'usd',
  })
  await expect(
    service.createCheckout(
      {
        ...input,
        items: [
          {
            bookId: '1',
            quantity: 1,
          },
        ],
      },
      buyer,
    ),
  ).rejects.toThrow('different')
})
it('blocks fulfillment until verified payment and atomically confirms exact evidence', async () => {
  const checkout = await service.createCheckout(input, buyer)
  const workflow = createAdminOrderRepository(db)
  await expect(
    workflow.setStatus(
      {
        id: checkout.order.id,
        expectedStatus: 'SUBMITTED',
        status: 'PREPARING',
      },
      actor,
    ),
  ).rejects.toThrow('payment')
  provider.pay([...provider.sessions.keys()][0])
  const paid = await service.refreshOrderPayment(checkout.order.id, buyer)
  expect(paid.payment.status).toBe('PAID')
  expect(paid.status).toBe('SUBMITTED')
  expect(
    (
      await workflow.setStatus(
        {
          id: paid.id,
          expectedStatus: 'SUBMITTED',
          status: 'PREPARING',
        },
        actor,
      )
    ).status,
  ).toBe('PREPARING')
})
it('confirms provider expiry before restoring inventory with explicit system attribution', async () => {
  const checkout = await service.createCheckout(input, buyer)
  now += 1861000
  provider.unavailable = true
  await service.recover()
  expect((await service.readOrder(checkout.order.id, buyer)).status).toBe('SUBMITTED')
  provider.unavailable = false
  now += 61000
  await service.recover()
  const expired = await service.readOrder(checkout.order.id, buyer)
  expect(expired.payment.status).toBe('EXPIRED')
  expect(expired.status).toBe('CANCELLED')
  expect(expired.history.at(-1)?.cancellationReason).toBe('Payment window expired')
  expect(
    db
      .prepare('SELECT actor_type,actor_role FROM order_status_events ORDER BY id DESC LIMIT 1')
      .get(),
  ).toEqual({
    actor_type: 'SYSTEM',
    actor_role: null,
  })
  await service.recover()
  expect(db.prepare('SELECT stock FROM books WHERE id=1').get()).toEqual({
    stock: 12,
  })
})
it('queues exactly one full refund on paid cancellation and reconciles failed retry', async () => {
  const c = await service.createCheckout(input, buyer)
  provider.pay([...provider.sessions.keys()][0])
  await service.refreshOrderPayment(c.order.id, buyer)
  provider.refundStatus = 'failed'
  const cancel = {
    id: c.order.id,
    expectedStatus: 'SUBMITTED' as const,
    status: 'CANCELLED' as const,
    cancellationReason: 'No stock',
  }
  await service.setOrderStatus(cancel, actor)
  await service.recover()
  expect((await service.readOrder(c.order.id, buyer)).payment.status).toBe('REFUND_FAILED')
  provider.refundStatus = 'succeeded'
  await service.retryOrderRefund(c.order.id)
  expect((await service.readOrder(c.order.id, buyer)).payment.status).toBe('REFUNDED')
  await service.setOrderStatus(cancel, actor)
  await service.retryOrderRefund(c.order.id)
  expect(provider.refunds.size).toBe(2)
  expect(db.prepare('SELECT stock FROM books WHERE id=1').get()).toEqual({
    stock: 12,
  })
})
it('rejects associated mismatches and duplicate events cannot duplicate local effects', async () => {
  const c = await service.createCheckout(input, buyer)
  const id = [...provider.sessions.keys()][0]
  provider.pay(id)
  provider.sessions.get(id)!.amountCents++
  await service.handleEvent({
    id: 'evt_bad',
    type: 'checkout.session.completed',
    resourceId: id,
  })
  expect((await service.readOrder(c.order.id, buyer)).payment.status).toBe('PENDING')
  expect(db.prepare('SELECT safe_error FROM payment_events WHERE id=?').get('evt_bad')).toEqual({
    safe_error: 'Provider resource did not match saved order',
  })
  provider.sessions.get(id)!.amountCents--
  await Promise.all([
    service.handleEvent({
      id: 'evt_ok',
      type: 'checkout.session.completed',
      resourceId: id,
    }),
    service.handleEvent({
      id: 'evt_ok',
      type: 'checkout.session.completed',
      resourceId: id,
    }),
  ])
  expect((await service.readOrder(c.order.id, buyer)).payment.status).toBe('PAID')
  expect(
    db
      .prepare(
        "SELECT count(*) n FROM activity_events WHERE action='ORDER_PAYMENT_CHANGED' AND changes_json LIKE '%PAID%'",
      )
      .get(),
  ).toEqual({
    n: 1,
  })
})
it('starts a stable provider expiry with enough guard to satisfy Stripe minimum after network latency', async () => {
  await service.createCheckout(input, buyer)
  expect([...provider.sessions.values()][0].expiresAt * 1000 - now).toBeGreaterThanOrEqual(1859000)
})
it('records associated mismatches from customer reconciliation for inspection', async () => {
  const c = await service.createCheckout(input, buyer)
  const id = [...provider.sessions.keys()][0]
  provider.pay(id)
  provider.sessions.get(id)!.intentAmountCents = 1
  await expect(service.refreshOrderPayment(c.order.id, buyer)).rejects.toThrow('did not match')
  expect(
    db.prepare("SELECT safe_error FROM payment_events WHERE type='RECONCILIATION'").get(),
  ).toEqual({
    safe_error: 'Provider resource did not match saved order',
  })
})
it('keeps stock after an unknown create outcome beyond retention and requires manual reconciliation', async () => {
  provider.uncertainCreate = true
  await expect(service.createCheckout(input, buyer)).rejects.toThrow('unavailable')
  now += 86400001
  await service.recover()
  expect(db.prepare('SELECT state FROM payment_operations').get()).toEqual({
    state: 'MANUAL',
  })
  expect(db.prepare('SELECT stock FROM books WHERE id=1').get()).toEqual({
    stock: 10,
  })
  expect(provider.sessions.size).toBe(1)
})
it('releases stock only on definitive create rejection, never an uncertain failure', async () => {
  provider.createSession = async () => {
    throw new ProviderRejection('rejected')
  }
  await expect(service.createCheckout(input, buyer)).rejects.toThrow('unavailable')
  expect(db.prepare('SELECT status,payment_status FROM orders').get()).toEqual({
    status: 'CANCELLED',
    payment_status: 'EXPIRED',
  })
  expect(db.prepare('SELECT stock FROM books WHERE id=1').get()).toEqual({
    stock: 12,
  })
})
it('retains cancellation intent and blocks resume until provider closure can be confirmed', async () => {
  const c = await service.createCheckout(input, buyer)
  provider.unavailable = true
  const cancel = {
    id: c.order.id,
    expectedStatus: 'SUBMITTED' as const,
    status: 'CANCELLED' as const,
    cancellationReason: 'Original',
  }
  await expect(service.setOrderStatus(cancel, actor)).rejects.toThrow('unavailable')
  await expect(service.resumeCheckout(c.order.id, buyer)).rejects.toThrow('unavailable')
  expect(db.prepare('SELECT stock FROM books WHERE id=1').get()).toEqual({
    stock: 10,
  })
  provider.unavailable = false
  provider.pay([...provider.sessions.keys()][0])
  await service.recover()
  await service.recover()
  expect(await service.readOrder(c.order.id, buyer)).toMatchObject({
    status: 'CANCELLED',
    payment: {
      status: 'REFUNDED',
    },
  })
  expect(provider.refunds.size).toBe(1)
})
it('refunds a verified unexpected late payment without reopening or restoring inventory twice', async () => {
  const c = await service.createCheckout(input, buyer)
  const id = [...provider.sessions.keys()][0]
  await service.setOrderStatus(
    {
      id: c.order.id,
      expectedStatus: 'SUBMITTED',
      status: 'CANCELLED',
      cancellationReason: 'No',
    },
    actor,
  )
  provider.pay(id)
  await service.handleEvent({
    id: 'evt_late',
    type: 'checkout.session.completed',
    resourceId: id,
  })
  await service.recover()
  expect(await service.readOrder(c.order.id, buyer)).toMatchObject({
    status: 'CANCELLED',
    payment: {
      status: 'REFUNDED',
    },
  })
  expect(db.prepare('SELECT stock FROM books WHERE id=1').get()).toEqual({
    stock: 12,
  })
  expect(provider.refunds.size).toBe(1)
})
it.each(['orders', 'activity_events'])(
  'rolls back verified payment and event deduplication when %s write fails',
  async (table) => {
    const c = await service.createCheckout(input, buyer)
    const id = [...provider.sessions.keys()][0]
    provider.pay(id)
    db.exec(
      `CREATE TRIGGER reject_payment BEFORE ${table === 'orders' ? 'UPDATE' : 'INSERT'} ON ${table} BEGIN SELECT RAISE(ABORT,'injected failure'); END`,
    )
    await expect(
      service.handleEvent({
        id: 'evt_retry',
        type: 'checkout.session.completed',
        resourceId: id,
      }),
    ).rejects.toThrow('injected failure')
    expect((await service.readOrder(c.order.id, buyer)).payment.status).toBe('PENDING')
    expect(db.prepare('SELECT processed_at FROM payment_events').get()).toEqual({
      processed_at: null,
    })
    db.exec('DROP TRIGGER reject_payment')
    await service.recover()
    expect((await service.readOrder(c.order.id, buyer)).payment.status).toBe('PAID')
  },
)
it('does not fulfill incomplete sessions even when other provider fields claim a successful intent', async () => {
  const c = await service.createCheckout(input, buyer)
  const id = [...provider.sessions.keys()][0]
  provider.pay(id)
  provider.sessions.get(id)!.status = 'open'
  await service.handleEvent({
    id: 'evt_incomplete',
    type: 'checkout.session.completed',
    resourceId: id,
  })
  expect((await service.readOrder(c.order.id, buyer)).payment.status).toBe('PENDING')
})
it('retains order/refund accuracy after lost refund response and restart recovery', async () => {
  const c = await service.createCheckout(input, buyer)
  const id = [...provider.sessions.keys()][0]
  provider.pay(id)
  await service.refreshOrderPayment(c.order.id, buyer)
  const createRefund = provider.createRefund.bind(provider)
  let lost = true
  provider.createRefund = async (input, key) => {
    const r = await createRefund(input, key)
    if (lost) {
      lost = false
      throw new Error('lost refund response')
    }
    return r
  }
  await service.setOrderStatus(
    {
      id: c.order.id,
      expectedStatus: 'SUBMITTED',
      status: 'CANCELLED',
      cancellationReason: 'No',
    },
    actor,
  )
  await service.recover()
  expect((await service.readOrder(c.order.id, buyer)).payment.status).toBe('REFUND_PENDING')
  expect(provider.refunds.size).toBe(1)
  now += 61000
  service = createPaymentService(
    createPaymentRepository(db, () => now),
    {
      provider,
      now: () => now,
      ...deliveryOptions,
      frontendOrigin: 'http://localhost:5173',
    },
  )
  await service.recover()
  expect((await service.readOrder(c.order.id, buyer)).payment.status).toBe('REFUNDED')
  expect(provider.refunds.size).toBe(1)
})
it('never regresses refunded state on delayed payment or refund event snapshots', async () => {
  const c = await service.createCheckout(input, buyer)
  const id = [...provider.sessions.keys()][0]
  provider.pay(id)
  await service.refreshOrderPayment(c.order.id, buyer)
  await service.setOrderStatus(
    {
      id: c.order.id,
      expectedStatus: 'SUBMITTED',
      status: 'CANCELLED',
      cancellationReason: 'No',
    },
    actor,
  )
  await service.recover()
  const r = [...provider.refunds.values()][0]
  r.status = 'pending'
  await service.handleEvent({
    id: 'evt_refund_old',
    type: 'refund.updated',
    resourceId: r.id,
  })
  await service.handleEvent({
    id: 'evt_session_old',
    type: 'checkout.session.completed',
    resourceId: id,
  })
  expect((await service.readOrder(c.order.id, buyer)).payment.status).toBe('REFUNDED')
})
it('rejects invalid, below-minimum and unavailable cart lines without reservations', async () => {
  for (const items of [
    [],
    [
      {
        bookId: '01',
        quantity: 1,
      },
    ],
    [
      {
        bookId: '1',
        quantity: 11,
      },
    ],
    [
      {
        bookId: '1',
        quantity: 1,
      },
      {
        bookId: '1',
        quantity: 1,
      },
    ],
  ])
    await expect(
      service.createCheckout(
        {
          ...input,
          items,
        },
        buyer,
      ),
    ).rejects.toThrow()
  db.exec('UPDATE books SET price_cents=49 WHERE id=1')
  await expect(
    service.createCheckout(
      {
        ...input,
        items: [
          {
            bookId: '1',
            quantity: 1,
          },
        ],
      },
      buyer,
    ),
  ).rejects.toThrow('50')
  db.exec('UPDATE books SET price_cents=100,stock=0 WHERE id=1')
  await expect(service.createCheckout(input, buyer)).rejects.toThrow('stock')
  expect(db.prepare('SELECT * FROM orders').all()).toEqual([])
  expect(provider.sessions.size).toBe(0)
})
it('rotates bounded reconciliation batches past twenty persistently mismatched pending orders', async () => {
  db.exec('UPDATE books SET stock=100 WHERE id=1')
  let last = ''
  for (let n = 0; n < 21; n++) {
    const c = await service.createCheckout(
      {
        requestKey: randomUUID(),
        deliveryAddress,
        expectedDeliveryFeeCents: 500,
        expectedTotalCents: 2199,
        items: [
          {
            bookId: '1',
            quantity: 1,
          },
        ],
      },
      buyer,
    )
    last = c.order.id
  }
  const sessions = [...provider.sessions.values()]
  for (const s of sessions.slice(0, 20)) s.amountCents++
  now += 1861000
  await service.recover()
  expect((await service.readOrder(last, buyer)).status).toBe('SUBMITTED')
  await service.recover()
  expect(await service.readOrder(last, buyer)).toMatchObject({
    status: 'CANCELLED',
    payment: {
      status: 'EXPIRED',
    },
  })
  expect(db.prepare('SELECT stock FROM books WHERE id=1').get()).toEqual({
    stock: 80,
  })
})
it('rotates event retries past twenty unavailable resources so a cancelled order late payment is refunded', async () => {
  const c = await service.createCheckout(input, buyer),
    id = [...provider.sessions.keys()][0]
  await service.setOrderStatus(
    {
      id: c.order.id,
      expectedStatus: 'SUBMITTED',
      status: 'CANCELLED',
      cancellationReason: 'No',
    },
    actor,
  )
  provider.pay(id)
  const retrieve = provider.retrieveSession.bind(provider)
  provider.retrieveSession = async (resource) => {
    if (resource.startsWith('missing_')) throw new Error('unavailable old resource')
    return retrieve(resource)
  }
  for (let n = 0; n < 20; n++)
    await expect(
      service.handleEvent({
        id: `evt_poison_${String(n).padStart(2, '0')}`,
        type: 'checkout.session.completed',
        resourceId: `missing_${n}`,
      }),
    ).rejects.toThrow('unavailable')
  provider.unavailable = true
  await expect(
    service.handleEvent({
      id: 'zz_evt_late',
      type: 'checkout.session.completed',
      resourceId: id,
    }),
  ).rejects.toThrow('offline')
  provider.unavailable = false
  await service.recover()
  expect((await service.readOrder(c.order.id, buyer)).payment.status).toBe('EXPIRED')
  await service.recover()
  expect((await service.readOrder(c.order.id, buyer)).payment.status).toBe('REFUND_PENDING')
  expect(
    db.prepare("SELECT processed_at FROM payment_events WHERE id='zz_evt_late'").get(),
  ).toEqual({
    processed_at: now,
  })
  await service.recover()
  expect((await service.readOrder(c.order.id, buyer)).payment.status).toBe('REFUNDED')
  expect(db.prepare('SELECT stock FROM books WHERE id=1').get()).toEqual({
    stock: 12,
  })
})
