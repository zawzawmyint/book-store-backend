import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { randomUUID } from 'node:crypto'
import { loadConfig } from '../src/config/env.js'
import { openDatabase } from '../src/database/runtime.js'
import { normalizeStore } from '../src/database/persistence.js'
import { seedRuntimeBooks } from '../src/database/runtime-seed.js'
import { seedDemoAccounts } from '../src/database/demo-seed.js'
import { createApp } from '../src/app.js'
import { createAuth } from '../src/auth.js'
import { createCatalogRepository } from '../src/modules/books/book.repository.js'
import { createAdminBookRepository } from '../src/modules/books/admin-book.repository.js'
import { createActivityRepository } from '../src/modules/activity/activity.repository.js'
import { activityInputSchema } from '../src/modules/activity/activity.validation.js'
import { operatorActor } from '../src/modules/activity/activity.types.js'
import { createAdminRepository } from '../src/modules/admin/admin.repository.js'
import { createAdminOrderRepository } from '../src/modules/orders/admin-order.repository.js'
import { createPaymentRepository } from '../src/modules/payments/payment.repository.js'
import { createPaymentService } from '../src/modules/payments/payment.service.js'
import { FakePaymentProvider } from './fake-payment-provider.js'
import type { DomainStore } from '../src/database/store.types.js'

const providerName = process.env.DATABASE_TEST_PROVIDER ?? 'sqlite'
if (!['sqlite', 'postgresql'].includes(providerName)) throw new Error('Invalid test provider')
const options = {
  frontendOrigin: 'http://localhost:5173',
  authBaseURL: 'http://localhost:5173',
  authSecret: 'database-parity-secret-at-least-thirty-two-characters',
  deliveryEnabled: true,
  deliveryCountryCodes: ['US', 'CA'],
  deliveryFeeCents: 500,
}
const config = loadConfig({
  NODE_ENV: 'test',
  DB_PROVIDER: providerName,
  DATABASE_PATH: ':memory:',
  DATABASE_URL: providerName === 'postgresql' ? process.env.TEST_DATABASE_URL : undefined,
  PG_TLS_MODE: 'disable',
  BETTER_AUTH_SECRET: options.authSecret,
})
if (providerName === 'postgresql') {
  const id = process.env.TEST_DATABASE_RUN_ID ?? ''
  const url = new URL(process.env.TEST_DATABASE_URL!)
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== `/book_store_test_${id.replaceAll('-', '')}`
  )
    throw new Error('Parity tests require the disposable local database owned by test:postgres')
}

describe(`database contract: ${providerName}`, () => {
  let database: Awaited<ReturnType<typeof openDatabase>>
  let store: DomainStore
  let provider: FakePaymentProvider
  let service: ReturnType<typeof createPaymentService>
  let buyer: { id: string; name: string; email: string }
  let now: number
  const address = {
    recipientName: 'Parity Recipient',
    phone: '+1 202 555 0123',
    addressLine1: '123 Reading Lane',
    addressLine2: null,
    city: 'Boston',
    region: null,
    postalCode: null,
    countryCode: 'US',
  }
  const input = () => ({
    requestKey: randomUUID(),
    items: [{ bookId: '1', quantity: 1 }],
    deliveryAddress: address,
    expectedDeliveryFeeCents: 500,
    expectedTotalCents: 2199,
  })

  beforeEach(async () => {
    database = await openDatabase(config)
    if (database.handle.provider === 'postgresql') {
      // Only the isolated, explicitly named test database can reach this statement.
      await database.handle.pool.query(
        'TRUNCATE TABLE "user", books, orders, activity_events, payment_events RESTART IDENTITY CASCADE',
      )
    }
    await seedRuntimeBooks(database.handle)
    store = normalizeStore(database.handle)
    buyer = (
      await createAuth(database.handle, options).api.signUpEmail({
        body: {
          name: 'Parity Buyer',
          email: 'buyer@example.com',
          password: 'parity-password-123',
        },
      })
    ).user
    provider = new FakePaymentProvider()
    now = Date.now()
    service = createPaymentService(
      createPaymentRepository(database.handle, () => now),
      { ...options, provider, now: () => now },
    )
  })
  afterEach(async () => {
    await database?.close()
  })

  it('quotes normalized delivery and money without reserving stock or provider resources', async () => {
    const before = (await store.book(1))!.stock
    const quote = await service.quoteCheckout({
      items: input().items,
      deliveryAddress: {
        ...address,
        recipientName: '  Parity Recipient  ',
        countryCode: ' us ',
        addressLine2: '   ',
      },
    })
    expect(quote).toEqual({
      subtotalCents: 1699,
      deliveryFeeCents: 500,
      totalCents: 2199,
      currency: 'usd',
    })
    expect((await store.book(1))!.stock).toBe(before)
    expect((await store.orderPage(50, 0)).total).toBe(0)
    expect(provider.sessions.size).toBe(0)
    await expect(async () =>
      service.quoteCheckout({
        items: input().items,
        deliveryAddress: { ...address, phone: '123' },
      }),
    ).rejects.toThrow()
    await expect(async () =>
      service.quoteCheckout({
        items: input().items,
        deliveryAddress: { ...address, countryCode: 'GB' },
      }),
    ).rejects.toThrow()
  })

  it('rejects price drift without writes and reuses saved retries before changed coverage or fee', async () => {
    const payload = input()
    const changedService = createPaymentService(
      createPaymentRepository(database.handle, () => now),
      {
        ...options,
        provider,
        now: () => now,
        deliveryCountryCodes: ['CA'],
        deliveryFeeCents: 700,
      },
    )
    await expect(
      service.createCheckout({ ...payload, expectedTotalCents: 2198 }, buyer),
    ).rejects.toThrow()
    expect((await store.orderPage(50, 0)).total).toBe(0)
    const saved = await service.createCheckout(payload, buyer)
    expect(saved.order.delivery.address).toEqual(address)
    expect(saved.order.subtotalCents).toBe(1699)
    expect(saved.order.deliveryFeeCents).toBe(500)
    await store.updateBook(1, { priceCents: 1800 })
    const retry = await changedService.createCheckout(payload, buyer)
    expect(retry.order.id).toBe(saved.order.id)
    expect(retry.order.totalCents).toBe(2199)
    await expect(
      changedService.createCheckout(
        { ...payload, deliveryAddress: { ...address, city: 'Toronto' } },
        buyer,
      ),
    ).rejects.toThrow('different')
    expect(provider.sessions.size).toBe(1)
  })

  it('supports explicit free delivery without hardcoded demo pricing', async () => {
    const free = createPaymentService(
      createPaymentRepository(database.handle, () => now),
      {
        ...options,
        provider,
        deliveryFeeCents: 0,
      },
    )
    const quote = await free.quoteCheckout({ items: input().items, deliveryAddress: address })
    expect(quote.deliveryFeeCents).toBe(0)
    const saved = await free.createCheckout(
      { ...input(), expectedDeliveryFeeCents: 0, expectedTotalCents: 1699 },
      buyer,
    )
    expect(saved.order.totalCents).toBe(1699)
    expect([...provider.sessions.values()][0].amountCents).toBe(1699)
  })

  it('ships and confirms delivery once with immutable tracking, timestamp and private history', async () => {
    const checkout = await service.createCheckout(input(), buyer)
    provider.pay([...provider.sessions.keys()][0])
    await service.refreshOrderPayment(checkout.order.id, buyer)
    const actor = {
      source: 'GRAPHQL' as const,
      userId: buyer.id,
      name: buyer.name,
      role: 'STAFF' as const,
    }
    await service.setOrderStatus(
      { id: checkout.order.id, expectedStatus: 'SUBMITTED', status: 'PREPARING' },
      actor,
    )
    const shipment = {
      carrier: 'Example Courier',
      trackingNumber: 'TRACK-123',
      trackingUrl: 'https://example.com/tracking/TRACK-123',
    }
    const shipped = await service.setOrderStatus(
      { id: checkout.order.id, expectedStatus: 'PREPARING', status: 'SHIPPED', shipment },
      actor,
    )
    expect(shipped.delivery.shippedAt).toBeTruthy()
    const retry = await service.setOrderStatus(
      { id: checkout.order.id, expectedStatus: 'PREPARING', status: 'SHIPPED', shipment },
      actor,
    )
    expect(retry.delivery.shippedAt).toBe(shipped.delivery.shippedAt)
    await expect(
      service.setOrderStatus(
        {
          id: checkout.order.id,
          expectedStatus: 'PREPARING',
          status: 'SHIPPED',
          shipment: { ...shipment, trackingNumber: 'OTHER' },
        },
        actor,
      ),
    ).rejects.toThrow()
    await expect(
      service.setOrderStatus(
        {
          id: checkout.order.id,
          expectedStatus: 'SHIPPED',
          status: 'CANCELLED',
          cancellationReason: 'Too late',
        },
        actor,
      ),
    ).rejects.toThrow()
    const delivered = await service.setOrderStatus(
      { id: checkout.order.id, expectedStatus: 'SHIPPED', status: 'DELIVERED' },
      actor,
    )
    const deliveredAgain = await service.setOrderStatus(
      { id: checkout.order.id, expectedStatus: 'SHIPPED', status: 'DELIVERED' },
      actor,
    )
    expect(deliveredAgain.delivery.deliveredAt).toBe(delivered.delivery.deliveredAt)
    expect(delivered.delivery.deliveredAt).toBeTruthy()
    expect(await store.history(Number(checkout.order.id))).toHaveLength(4)
    expect(provider.refunds.size).toBe(0)
    expect(
      await createPaymentRepository(database.handle, () => now).customerOrders.getOrderForUser(
        'other',
        checkout.order.id,
      ),
    ).toBeNull()
    const activity = await createActivityRepository(database.handle).list(
      activityInputSchema.parse({ targetType: 'ORDER', targetId: checkout.order.id }),
    )
    const publicChanges = JSON.stringify(activity.items)
    expect(publicChanges).not.toContain(address.addressLine1)
    expect(publicChanges).not.toContain(address.phone)
    expect(publicChanges).not.toContain(shipment.trackingUrl)
  })

  it('rolls back shipment details and timestamp if Activity insertion fails', async () => {
    const checkout = await service.createCheckout(input(), buyer)
    provider.pay([...provider.sessions.keys()][0])
    await service.refreshOrderPayment(checkout.order.id, buyer)
    const actor = {
      source: 'GRAPHQL' as const,
      userId: buyer.id,
      name: buyer.name,
      role: 'STAFF' as const,
    }
    await service.setOrderStatus(
      { id: checkout.order.id, expectedStatus: 'SUBMITTED', status: 'PREPARING' },
      actor,
    )
    const failure: DomainStore = {
      ...store,
      transaction: (work) =>
        store.transaction((tx) =>
          work({
            ...tx,
            insertActivity: async () => {
              throw new Error('Injected Activity failure')
            },
          }),
        ),
    }
    await expect(
      createAdminOrderRepository(failure).setStatus(
        {
          id: checkout.order.id,
          expectedStatus: 'PREPARING',
          status: 'SHIPPED',
          shipment: { carrier: 'Courier', trackingNumber: '123' },
        },
        actor,
      ),
    ).rejects.toThrow('Injected')
    const saved = await service.readOrder(checkout.order.id, buyer)
    expect(saved.status).toBe('PREPARING')
    expect(saved.delivery.shippedAt).toBeNull()
    expect(saved.delivery.shipment).toBeNull()
    expect(await store.history(Number(checkout.order.id))).toHaveLength(2)
  })
  it.each(['insertDelivery', 'insertHistory', 'insertCheckout', 'insertOperation'] as const)(
    'rolls back the full checkout when %s fails',
    async (method) => {
      const before = (await store.book(1))!.stock
      const payload = input()
      const withFailure = (tx: DomainStore): DomainStore => ({
        ...tx,
        [method]: async () => {
          throw new Error('Injected reservation failure')
        },
        transaction: (work) => tx.transaction((next) => work(withFailure(next))),
      })
      const failure = withFailure(store)
      const failing = createPaymentService(
        createPaymentRepository(failure, () => now),
        { ...options, provider },
      )
      await expect(failing.createCheckout(payload, buyer)).rejects.toThrow('Injected')
      expect((await store.book(1))!.stock).toBe(before)
      expect((await store.orderPage(50, 0)).total).toBe(0)
      expect(await store.checkout(buyer.id, payload.requestKey)).toBeUndefined()
      expect(provider.sessions.size).toBe(0)
    },
  )

  it('enforces matching persisted delivery money and timestamp constraints', async () => {
    const checkout = await service.createCheckout(input(), buyer)
    const id = Number(checkout.order.id)
    await expect(store.updateOrder(id, { totalCents: 1 })).rejects.toThrow()
    await expect(store.updateOrder(id, { deliveryFeeCents: -1 })).rejects.toThrow()
    await expect(
      store.updateDelivery(id, { deliveredAt: new Date(now).toISOString() }),
    ).rejects.toThrow()
    await expect(
      store.updateDelivery(id, { trackingUrl: 'https://example.com/track' }),
    ).rejects.toThrow()
    expect((await store.order(id))!.totalCents).toBe(2199)
    expect((await store.delivery(id))!.deliveredAt).toBeNull()
  })
  it('keeps catalog search, literal wildcards, ordering, genres and page counts', async () => {
    const catalog = createCatalogRepository(database.handle)
    expect((await catalog.listBooks('GATSBY', 12, 0)).items[0].title).toBe('The Great Gatsby')
    for (const search of ['%', '_', '\\'])
      expect((await catalog.listBooks(search, 12, 0)).total).toBe(0)
    const page = await catalog.listBooks('', 5, 5)
    expect(page.total).toBe(12)
    expect(page.items.map((book) => book.id)).toEqual([6, 7, 8, 9, 10])
    expect(await catalog.listGenres()).toEqual([...(await catalog.listGenres())].sort())
  })

  it('supports actual login, viewer permissions, owner privacy and repeatable demo seeding', async () => {
    await seedDemoAccounts(database.handle, options, 'test')
    await seedDemoAccounts(database.handle, options, 'test')
    const app = await createApp(database.handle, options, { ...options, provider })
    const login = await request(app)
      .post('/api/auth/sign-in/email')
      .set('Origin', options.frontendOrigin)
      .send({ email: 'demo-admin@example.com', password: 'BookstoreDemo123!' })
    expect(login.status).toBe(200)
    const response = await request(app)
      .post('/graphql')
      .set('Origin', options.frontendOrigin)
      .set('Cookie', login.headers['set-cookie'])
      .send({ query: '{ viewer { role } adminBooks { total } }' })
    expect(response.body.errors).toBeUndefined()
    expect(response.body.data.viewer.role).toBe('ADMIN')
    const checkout = await service.createCheckout(input(), buyer)
    expect(await createAdminOrderRepository(database.handle).get(checkout.order.id)).not.toBeNull()
    expect(
      await createPaymentRepository(database.handle, () => now).customerOrders.getOrderForUser(
        'other',
        checkout.order.id,
      ),
    ).toBeNull()
    const guestQuote = await request(app)
      .post('/graphql')
      .set('Origin', options.frontendOrigin)
      .send({ query: '{ deliveryOptions { feeCents } }' })
    expect(guestQuote.body.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED')
    const buyerLogin = await request(app)
      .post('/api/auth/sign-in/email')
      .set('Origin', options.frontendOrigin)
      .send({ email: buyer.email, password: 'parity-password-123' })
    const owned = await request(app)
      .post('/graphql')
      .set('Origin', options.frontendOrigin)
      .set('Cookie', buyerLogin.headers['set-cookie'])
      .send({
        query:
          'query ($id: ID!) { myOrder(id: $id) { delivery { address { phone addressLine1 } } subtotalCents deliveryFeeCents totalCents } }',
        variables: { id: checkout.order.id },
      })
    expect(owned.status).toBe(200)
    expect(owned.body.errors).toBeUndefined()
    expect(owned.body.data.myOrder.delivery.address.phone).toBe(address.phone)
    const nonOwned = await request(app)
      .post('/graphql')
      .set('Origin', options.frontendOrigin)
      .set('Cookie', login.headers['set-cookie'])
      .send({
        query: 'query ($id: ID!) { myOrder(id: $id) { id delivery { address { phone } } } }',
        variables: { id: checkout.order.id },
      })
    expect(nonOwned.status).toBe(200)
    expect(nonOwned.body.errors).toBeUndefined()
    expect(nonOwned.body.data.myOrder).toBeNull()
    const roles = createAdminRepository(database.handle)
    await roles.setUserRole(buyer.id, 'STAFF', {
      source: 'OPERATOR',
      userId: null,
      name: 'Operator command',
      role: null,
    })
    expect(await roles.getUserRole(buyer.id)).toBe('STAFF')
  })

  async function secondService() {
    if (database.handle.provider === 'sqlite') return { service, close: async () => {} }
    const other = await openDatabase(config)
    return {
      service: createPaymentService(
        createPaymentRepository(other.handle, () => now),
        { ...options, provider, now: () => now },
      ),
      close: other.close,
    }
  }

  it('keeps book administration, Activity JSON filtering and password/session revocation portable', async () => {
    const books = createAdminBookRepository(database.handle)
    const details = {
      title: 'Portable Book',
      author: 'Author',
      genre: 'Test',
      description: 'Description',
      priceCents: 1234,
    }
    const book = await books.create(details, 4, operatorActor)
    await books.update(String(book.id), { ...details, title: 'Updated Book' }, operatorActor)
    await books.adjustStock(String(book.id), -1, operatorActor)
    await books.archive(String(book.id), true, operatorActor)
    expect(await createCatalogRepository(database.handle).getBook(String(book.id))).toBeNull()
    await books.archive(String(book.id), false, operatorActor)
    const activity = createActivityRepository(database.handle)
    const filtered = await activity.list(
      activityInputSchema.parse({
        targetType: 'BOOK',
        targetId: String(book.id),
        changedField: 'TITLE',
      }),
    )
    expect(filtered.total).toBe(2)
    expect(filtered.items[0].changes).toEqual([
      { field: 'TITLE', before: 'Portable Book', after: 'Updated Book' },
    ])
    const auth = createAuth(database.handle, options)
    const app = await createApp(database.handle, options, { ...options, provider })
    const response = await request(app)
      .post('/api/auth/sign-in/email')
      .set('Origin', options.frontendOrigin)
      .send({ email: buyer.email, password: 'parity-password-123' })
    const cookies = response.headers['set-cookie']
    expect(
      (
        await request(app)
          .post('/graphql')
          .set('Origin', options.frontendOrigin)
          .set('Cookie', cookies)
          .send({ query: '{ viewer { id } }' })
      ).body.data.viewer.id,
    ).toBe(buyer.id)
    await createAdminRepository(database.handle).resetUserPassword(
      buyer.id,
      'replacement-password-123',
      operatorActor,
    )
    expect(
      (
        await request(app)
          .post('/graphql')
          .set('Origin', options.frontendOrigin)
          .set('Cookie', cookies)
          .send({ query: '{ viewer { id } }' })
      ).body.data.viewer,
    ).toBeNull()
    await expect(
      auth.api.signInEmail({ body: { email: buyer.email, password: 'parity-password-123' } }),
    ).rejects.toThrow()
    expect(
      (
        await auth.api.signInEmail({
          body: { email: buyer.email, password: 'replacement-password-123' },
        })
      ).user.id,
    ).toBe(buyer.id)
  })

  it('never oversells the final stock unit across concurrent connections', async () => {
    await store.updateBook(1, { stock: 1 })
    const other = await secondService()
    try {
      const outcomes = await Promise.allSettled([
        service.createCheckout(input(), buyer),
        other.service.createCheckout(input(), buyer),
      ])
      expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect((await store.book(1))!.stock).toBe(0)
      expect((await store.orderPage(50, 0)).total).toBe(1)
      expect(provider.sessions.size).toBe(1)
    } finally {
      await other.close()
    }
  })

  it('deduplicates matching concurrent request keys and conflicts on changed payload', async () => {
    const before = (await store.book(1))!.stock
    const payload = input()
    const other = await secondService()
    try {
      await Promise.allSettled([
        service.createCheckout(payload, buyer),
        other.service.createCheckout(payload, buyer),
      ])
      const result = await service.createCheckout(payload, buyer)
      expect((await store.orderPage(50, 0)).total).toBe(1)
      expect((await store.book(1))!.stock).toBe(before - 1)
      expect(provider.sessions.size).toBe(1)
      await expect(
        service.createCheckout({ ...payload, items: [{ bookId: '1', quantity: 2 }] }, buyer),
      ).rejects.toThrow('different')
      expect(result.order.totalCents).toBe(2199)
    } finally {
      await other.close()
    }
  })

  it('confirms payment once, enforces workflow and refunds/restocks once under cancellation retries', async () => {
    const before = (await store.book(1))!.stock
    const checkout = await service.createCheckout(input(), buyer)
    const actor = {
      source: 'GRAPHQL' as const,
      userId: buyer.id,
      name: buyer.name,
      role: 'STAFF' as const,
    }
    await expect(
      service.setOrderStatus(
        { id: checkout.order.id, expectedStatus: 'SUBMITTED', status: 'PREPARING' },
        actor,
      ),
    ).rejects.toThrow('payment')
    const sessionId = [...provider.sessions.keys()][0]
    provider.pay(sessionId)
    const event = {
      id: 'evt_parity_paid',
      type: 'checkout.session.completed',
      resourceId: sessionId,
    }
    await Promise.all([service.handleEvent(event), service.handleEvent(event)])
    await service.refreshOrderPayment(checkout.order.id, buyer)
    expect((await store.event(event.id))!.processedAt).toBe(now)
    const paid = await service.readOrder(checkout.order.id, buyer)
    expect(paid.payment.status).toBe('PAID')
    await service.setOrderStatus(
      { id: paid.id, expectedStatus: 'SUBMITTED', status: 'PREPARING' },
      actor,
    )
    const cancellation = {
      id: paid.id,
      expectedStatus: 'PREPARING',
      status: 'CANCELLED',
      cancellationReason: 'Test cancellation',
    }
    await Promise.all([
      service.setOrderStatus(cancellation, actor),
      service.setOrderStatus(cancellation, actor),
    ])
    await service.recover()
    expect((await store.book(1))!.stock).toBe(before)
    expect(provider.refunds.size).toBe(1)
    expect([...provider.refunds.values()][0].amountCents).toBe(2199)
    expect((await service.readOrder(paid.id, buyer)).payment.status).toBe('REFUNDED')
    expect(await store.history(Number(paid.id))).toHaveLength(3)
  })

  it('rolls back stock, workflow and history when Activity insertion fails', async () => {
    const checkout = await service.createCheckout(input(), buyer)
    provider.pay([...provider.sessions.keys()][0])
    await service.refreshOrderPayment(checkout.order.id, buyer)
    const before = (await store.book(1))!.stock
    const failureStore: DomainStore = {
      ...store,
      transaction: (work) =>
        store.transaction((tx) =>
          work({
            ...tx,
            insertActivity: async () => {
              throw new Error('Injected Activity failure')
            },
          }),
        ),
    }
    await expect(
      createAdminOrderRepository(failureStore).setStatus(
        {
          id: checkout.order.id,
          expectedStatus: 'SUBMITTED',
          status: 'CANCELLED',
          cancellationReason: 'Fault test',
        },
        { source: 'GRAPHQL', userId: buyer.id, name: buyer.name, role: 'STAFF' },
      ),
    ).rejects.toThrow('Injected')
    expect((await store.book(1))!.stock).toBe(before)
    expect((await store.order(Number(checkout.order.id)))!.status).toBe('SUBMITTED')
    expect(await store.history(Number(checkout.order.id))).toHaveLength(1)
  })

  it('rejects stale lease completion after another worker acquires the expired operation', async () => {
    const repository = createPaymentRepository(database.handle, () => now)
    const order = await repository.reserve(input(), buyer, options)
    const first = (await repository.claim(`checkout:${order.id}`))!
    now += 31000
    const second = (await repository.claim(first.id))!
    expect(second.leaseToken).not.toBe(first.leaseToken)
    const session = await provider.createSession(
      {
        orderId: String(order.id),
        expiresAt: Math.floor(now / 1000) + 1800,
        lines: [{ title: 'Book', quantity: 1, unitPriceCents: order.totalCents }],
        successUrl: options.frontendOrigin,
        cancelUrl: options.frontendOrigin,
      },
      first.id,
    )
    await repository.completeSession(first, session)
    expect((await repository.operation(first.id))!.leaseToken).toBe(second.leaseToken)
    expect((await repository.get(order.id))!.stripeSessionId).toBeNull()
  })

  it('grants one lease to concurrent workers', async () => {
    const repository = createPaymentRepository(database.handle, () => now)
    const order = await repository.reserve(input(), buyer, options)
    const other = database.handle.provider === 'postgresql' ? await openDatabase(config) : database
    try {
      const contender = createPaymentRepository(other.handle, () => now)
      const claims = await Promise.all([
        repository.claim(`checkout:${order.id}`),
        contender.claim(`checkout:${order.id}`),
      ])
      expect(claims.filter(Boolean)).toHaveLength(1)
      expect((await repository.operation(`checkout:${order.id}`))!.attempts).toBe(1)
    } finally {
      if (other !== database) await other.close()
    }
  })

  it('serializes shipping versus cancellation across independent connections', async () => {
    const checkout = await service.createCheckout(input(), buyer)
    provider.pay([...provider.sessions.keys()][0])
    await service.refreshOrderPayment(checkout.order.id, buyer)
    const actor = {
      source: 'GRAPHQL' as const,
      userId: buyer.id,
      name: buyer.name,
      role: 'STAFF' as const,
    }
    const workflow = createAdminOrderRepository(database.handle)
    await workflow.setStatus(
      { id: checkout.order.id, expectedStatus: 'SUBMITTED', status: 'PREPARING' },
      actor,
    )
    const other = database.handle.provider === 'postgresql' ? await openDatabase(config) : database
    try {
      const outcomes = await Promise.allSettled([
        service.setOrderStatus(
          { id: checkout.order.id, expectedStatus: 'PREPARING', status: 'SHIPPED' },
          actor,
        ),
        createPaymentService(
          createPaymentRepository(other.handle, () => now),
          { ...options, provider, now: () => now },
        ).setOrderStatus(
          {
            id: checkout.order.id,
            expectedStatus: 'PREPARING',
            status: 'CANCELLED',
            cancellationReason: 'Concurrent cancellation',
          },
          actor,
        ),
      ])
      expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(await store.history(Number(checkout.order.id))).toHaveLength(3)
      const saved = (await store.order(Number(checkout.order.id)))!
      expect((await store.book(1))!.stock).toBe(saved.status === 'CANCELLED' ? 12 : 11)
      await service.recover()
      expect(provider.refunds.size).toBe(saved.status === 'CANCELLED' ? 1 : 0)
      const detail = await service.readOrder(checkout.order.id, buyer)
      expect(Boolean(detail.delivery.shippedAt)).toBe(saved.status === 'SHIPPED')
    } finally {
      if (other !== database) await other.close()
    }
  })
})
