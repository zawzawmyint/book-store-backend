import { revokeUnverifiedSessions } from '../src/modules/auth-email/session-rollout.js'
import { createCartRepository } from '../src/modules/cart/cart.repository.js'
import { createCartService } from '../src/modules/cart/cart.service.js'
import { capturedFixtureSender } from './verified-auth-fixture.js'
import { createSeedAccountStore } from '../src/database/runtime-seed.js'
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
  emailSender: capturedFixtureSender,
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
  it.skipIf(providerName !== 'postgresql')(
    'projects a cart without waiting for another owner stock write lock',
    async () => {
      if (database.handle.provider !== 'postgresql') return
      const cart = createCartService(createCartRepository(database.handle))
      await cart.set(buyer.id, {
        bookId: '1',
        quantity: 1,
        expectedRevision: '0',
        requestKey: randomUUID(),
      })
      const writer = await database.handle.pool.connect()
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await writer.query('BEGIN')
        await writer.query('SELECT id FROM books WHERE id=1 FOR UPDATE')
        const reading = cart.read(buyer.id)
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Cart projection waited for unrelated stock writer')),
            2000,
          )
        })
        expect((await Promise.race([reading, timeout])).items[0].bookId).toBe('1')
      } finally {
        if (timer) clearTimeout(timer)
        await writer.query('ROLLBACK')
        writer.release()
      }
    },
  )
  it('rolls paid truth and cleanup back together on local failure, then recovers exactly once', async () => {
    const cart = createCartService(createCartRepository(database.handle))
    await cart.set(buyer.id, {
      bookId: '1',
      quantity: 1,
      expectedRevision: '0',
      requestKey: randomUUID(),
    })
    const checkout = await service.createCheckout({ ...input(), cartRevision: '1' }, buyer)
    const row = (await store.order(Number(checkout.order.id)))!
    provider.pay(row.stripeSessionId!)
    const fault = new Proxy(store, {
      get(target, key) {
        if (key === 'transaction')
          return (work: (tx: DomainStore) => Promise<unknown>) =>
            target.transaction((tx) =>
              work(
                new Proxy(tx, {
                  get(scoped, field) {
                    if (field === 'cleanCartSnapshot')
                      return async () => {
                        throw new Error('Injected cart cleanup failure')
                      }
                    return Reflect.get(scoped, field)
                  },
                }),
              ),
            )
        return Reflect.get(target, key)
      },
    })
    await expect(
      createPaymentRepository(fault, () => now).reconcileSession(
        await provider.retrieveSession(row.stripeSessionId!),
      ),
    ).rejects.toThrow('Injected')
    expect((await store.order(row.id))!.paymentStatus).toBe('PENDING')
    expect((await store.cartSnapshot(row.id))!.cleanedAt).toBeNull()
    expect((await cart.read(buyer.id)).items).toHaveLength(1)
    await service.recover()
    expect((await store.order(row.id))!.paymentStatus).toBe('PAID')
    expect((await cart.read(buyer.id)).items).toEqual([])
  })
  it('retains unavailable lines with live metadata, permits repair and never reserves stock', async () => {
    const cart = createCartService(createCartRepository(database.handle))
    const set = (quantity: number, expectedRevision: string) =>
      cart.set(buyer.id, { bookId: '1', quantity, expectedRevision, requestKey: randomUUID() })
    await set(3, '0')
    await store.updateBook(1, { archived: true, stock: 1, priceCents: 999 })
    expect((await cart.read(buyer.id)).items[0]).toMatchObject({
      quantity: 3,
      available: false,
      priceCents: 999,
      stock: 1,
    })
    await expect(set(4, '1')).rejects.toThrow('unavailable')
    await set(2, '1')
    const merged = await cart.merge(buyer.id, {
      items: [{ bookId: '1', quantity: 1 }],
      expectedRevision: '2',
      requestKey: randomUUID(),
    })
    expect(merged.items[0].quantity).toBe(2)
    expect(merged.mergeNotices).toEqual([{ bookId: '1', reason: 'UNAVAILABLE' }])
    await set(0, '2')
    expect((await cart.read(buyer.id)).items).toEqual([])
    expect((await store.book(1))!.stock).toBe(1)
  })
  it('normalizes merge ordering, keeps account lines at capacity and rejects invalid snapshots atomically', async () => {
    const cart = createCartService(createCartRepository(database.handle))
    for (let i = 0; i < 22; i++)
      await store.createBook({
        title: `Extra ${i}`,
        author: 'Author',
        genre: 'Genre',
        description: 'Book',
        priceCents: 100,
        stock: 10,
      })
    const account = Array.from({ length: 19 }, (_, i) => ({ bookId: String(i + 1), quantity: 1 }))
    const initial = await cart.merge(buyer.id, {
      items: account,
      expectedRevision: '0',
      requestKey: randomUUID(),
    })
    expect(initial.items).toHaveLength(19)
    const result = await cart.merge(buyer.id, {
      items: [
        { bookId: '22', quantity: 1 },
        { bookId: '20', quantity: 1 },
        { bookId: '21', quantity: 1 },
      ],
      expectedRevision: '1',
      requestKey: randomUUID(),
    })
    expect(result.items.map((l) => l.bookId)).toEqual(
      Array.from({ length: 20 }, (_, i) => String(i + 1)),
    )
    expect(result.mergeNotices).toEqual([
      { bookId: '21', reason: 'LINE_LIMIT' },
      { bookId: '22', reason: 'LINE_LIMIT' },
    ])
    await expect(
      cart.set(buyer.id, {
        bookId: '21',
        quantity: 1,
        expectedRevision: '2',
        requestKey: randomUUID(),
      }),
    ).rejects.toThrow('20')
    const key = randomUUID()
    expect(() =>
      cart.merge(buyer.id, {
        items: [
          { bookId: '1', quantity: 1 },
          { bookId: '1', quantity: 2 },
        ],
        expectedRevision: '2',
        requestKey: key,
      }),
    ).toThrow('once')
    expect(await store.cartOperation(buyer.id, key)).toBeUndefined()
    expect((await cart.read(buyer.id)).revision).toBe('2')
  })
  it('does not consume failed operation keys and persists version changes after remove and re-add', async () => {
    const cart = createCartService(createCartRepository(database.handle)),
      key = randomUUID()
    await expect(
      cart.set(buyer.id, { bookId: '1', quantity: 1, expectedRevision: '7', requestKey: key }),
    ).rejects.toThrow('cart changed')
    expect(await store.cartOperation(buyer.id, key)).toBeUndefined()
    const first = await cart.set(buyer.id, {
      bookId: '1',
      quantity: 1,
      expectedRevision: '0',
      requestKey: key,
    })
    const noOp = await cart.set(buyer.id, {
      bookId: '1',
      quantity: 1,
      expectedRevision: '1',
      requestKey: randomUUID(),
    })
    expect(noOp.revision).toBe('1')
    expect(noOp.items[0].lineVersion).toBe(first.items[0].lineVersion)
    await cart.set(buyer.id, {
      bookId: '1',
      quantity: 0,
      expectedRevision: '1',
      requestKey: randomUUID(),
    })
    const added = await cart.set(buyer.id, {
      bookId: '1',
      quantity: 1,
      expectedRevision: '2',
      requestKey: randomUUID(),
    })
    expect(added.items[0].lineVersion).not.toBe(first.items[0].lineVersion)
    expect(
      (
        await cart.set(buyer.id, {
          bookId: '1',
          quantity: 1,
          expectedRevision: '0',
          requestKey: key,
        })
      ).revision,
    ).toBe('3')
    for (const input of [
      { quantity: 11 },
      { quantity: -1 },
      { quantity: 1.5 },
      { bookId: '01' },
      { expectedRevision: '-1' },
      { expectedRevision: '0'.repeat(101) },
      { requestKey: 'not-uuid' },
    ])
      expect(() =>
        cart.set(buyer.id, {
          bookId: '1',
          quantity: 1,
          expectedRevision: '3',
          requestKey: randomUUID(),
          ...input,
        }),
      ).toThrow()
    expect((await cart.read(buyer.id)).revision).toBe('3')
  })
  it('validates exact checkout lines, replays original revision and preserves remove/re-added paid lines', async () => {
    const cart = createCartService(createCartRepository(database.handle))
    await cart.set(buyer.id, {
      bookId: '1',
      quantity: 1,
      expectedRevision: '0',
      requestKey: randomUUID(),
    })
    await expect(
      service.createCheckout(
        {
          ...input(),
          items: [{ bookId: '1', quantity: 2 }],
          expectedTotalCents: 3898,
          cartRevision: '1',
        },
        buyer,
      ),
    ).rejects.toThrow('cart changed')
    const payload = { ...input(), cartRevision: '1' },
      saved = await service.createCheckout(payload, buyer)
    await cart.set(buyer.id, {
      bookId: '1',
      quantity: 0,
      expectedRevision: '1',
      requestKey: randomUUID(),
    })
    await cart.set(buyer.id, {
      bookId: '1',
      quantity: 1,
      expectedRevision: '2',
      requestKey: randomUUID(),
    })
    expect((await service.createCheckout(payload, buyer)).order.id).toBe(saved.order.id)
    await expect(service.createCheckout({ ...payload, cartRevision: '3' }, buyer)).rejects.toThrow(
      'Request key',
    )
    const row = (await store.order(Number(saved.order.id)))!
    provider.pay(row.stripeSessionId!)
    await service.recover()
    expect((await cart.read(buyer.id)).revision).toBe('3')
    expect((await cart.read(buyer.id)).items).toHaveLength(1)
    expect((await store.cartSnapshot(row.id))!.cleanedAt).toBeTruthy()
  })
  it('serializes first-cart writers and durable merges on both database providers', async () => {
    const cart = createCartService(createCartRepository(database.handle))
    const operation = { bookId: '1', quantity: 2, expectedRevision: '0', requestKey: randomUUID() }
    const results = await Promise.allSettled([
      cart.set(buyer.id, operation),
      cart.set(buyer.id, { ...operation, quantity: 3, requestKey: randomUUID() }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    const current = await cart.read(buyer.id)
    expect(current.revision).toBe('1')
    const merge = {
      items: [{ bookId: '1', quantity: 10 }],
      expectedRevision: '1',
      requestKey: randomUUID(),
    }
    const merged = await cart.merge(buyer.id, merge)
    expect(merged.items[0].quantity).toBe(10)
    expect(merged.mergeNotices).toEqual([{ bookId: '1', reason: 'QUANTITY_LIMIT' }])
    await cart.set(buyer.id, {
      bookId: '2',
      quantity: 1,
      expectedRevision: '2',
      requestKey: randomUUID(),
    })
    const replay = await cart.merge(buyer.id, merge)
    expect(replay.revision).toBe('3')
    expect(replay.items).toHaveLength(2)
    expect(replay.mergeNotices).toEqual(merged.mergeNotices)
  })
  it('rejects stale linked checkout before stock reservation and preserves legacy checkout', async () => {
    const cart = createCartService(createCartRepository(database.handle))
    await cart.set(buyer.id, {
      bookId: '1',
      quantity: 1,
      expectedRevision: '0',
      requestKey: randomUUID(),
    })
    await expect(service.createCheckout({ ...input(), cartRevision: '0' }, buyer)).rejects.toThrow(
      'cart changed',
    )
    expect((await store.orderPage(10, 0)).total).toBe(0)
    expect((await store.book(1))!.stock).toBe(12)
    await service.createCheckout(input(), buyer)
    expect((await cart.read(buyer.id)).items).toHaveLength(1)
  })
  it('cleans only unchanged purchased versions once through recovery without a browser', async () => {
    const cart = createCartService(createCartRepository(database.handle))
    await cart.set(buyer.id, {
      bookId: '1',
      quantity: 1,
      expectedRevision: '0',
      requestKey: randomUUID(),
    })
    await cart.set(buyer.id, {
      bookId: '2',
      quantity: 1,
      expectedRevision: '1',
      requestKey: randomUUID(),
    })
    const before = await cart.read(buyer.id)
    const quote = await service.quoteCheckout({
      items: before.items.map((l) => ({ bookId: l.bookId, quantity: l.quantity })),
      deliveryAddress: address,
    })
    const checkout = await service.createCheckout(
      {
        ...input(),
        items: before.items.map((l) => ({ bookId: l.bookId, quantity: l.quantity })),
        expectedTotalCents: quote.totalCents,
        cartRevision: before.revision,
      },
      buyer,
    )
    await cart.set(buyer.id, {
      bookId: '1',
      quantity: 2,
      expectedRevision: '2',
      requestKey: randomUUID(),
    })
    await cart.set(buyer.id, {
      bookId: '1',
      quantity: 1,
      expectedRevision: '3',
      requestKey: randomUUID(),
    })
    const row = (await store.order(Number(checkout.order.id)))!
    provider.pay(row.stripeSessionId!)
    const recovered = createPaymentService(
      createPaymentRepository(database.handle, () => now),
      { ...options, provider, now: () => now },
    )
    await recovered.recover()
    const after = await cart.read(buyer.id)
    expect(after.revision).toBe('5')
    expect(after.items.map((l) => l.bookId)).toEqual(['1'])
    await cart.set(buyer.id, {
      bookId: '2',
      quantity: 1,
      expectedRevision: '5',
      requestKey: randomUUID(),
    })
    await recovered.handleEvent({
      id: 'paid-repeated',
      type: 'checkout.session.completed',
      resourceId: row.stripeSessionId!,
    })
    expect((await cart.read(buyer.id)).items.map((l) => l.bookId)).toEqual(['1', '2'])
    expect((await store.cartSnapshot(row.id))?.cleanedAt).toBeTruthy()
  })
  it('matches case differences in accented and non-Latin saved customer names', async () => {
    for (const [customerName, term] of [
      ['ÉLODIE', 'élodie'],
      ['АЛЕКСЕЙ', 'алексей'],
    ]) {
      const order = await store.createOrder({
        customerName,
        email: 'unicode@test.example',
        subtotalCents: 100,
        deliveryFeeCents: 0,
        totalCents: 100,
        createdAt: '2026-10-01 10:00:00',
        status: 'SUBMITTED',
      })
      const result = await store.orderPage(5, 0, undefined, undefined, term)
      expect(result.items.map((row) => row.id)).toEqual([order.id])
      expect(result.total).toBe(1)
    }
  })
  it('matches exact order IDs and escaped contacts with status/pagination and owner scope', async () => {
    const values = {
      subtotalCents: 100,
      deliveryFeeCents: 0,
      totalCents: 100,
      createdAt: '2026-10-01 10:00:00',
    }
    const first = await store.createOrder({
      ...values,
      customerName: '50%_Reader\\Club',
      email: 'literal@test.example',
      userId: buyer.id,
      status: 'PREPARING',
    })
    const second = await store.createOrder({
      ...values,
      customerName: 'Other',
      email: 'other@test.example',
      status: 'SUBMITTED',
    })
    for (const term of [`#00${first.id}`, String(first.id), ' LITERAL@TEST ', '50%_Reader\\']) {
      const result = await store.orderPage(5, 0, undefined, undefined, term)
      expect(result.total).toBe(1)
      expect(result.items.map((row) => row.id)).toEqual([first.id])
    }
    expect((await store.orderPage(5, 0, undefined, undefined, '#99999999999999999999')).total).toBe(
      0,
    )
    expect((await store.orderPage(5, 0, undefined, 'PREPARING', 'example')).total).toBe(1)
    const paged = await store.orderPage(1, 1, undefined, undefined, 'example')
    expect(paged.total).toBe(2)
    expect(paged.items.map((row) => row.id)).toEqual([first.id])
    expect((await store.orderPage(5, 0, buyer.id, undefined, String(second.id))).total).toBe(0)
    expect((await store.orderPage(5, 0, buyer.id)).total).toBe(1)
  })
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
    await createSeedAccountStore(database.handle).markVerified(buyer.id)
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

  it('returns the saved verification flag in admin user lists and details on either provider', async () => {
    const pending = (
      await createAuth(database.handle, options).api.signUpEmail({
        body: {
          name: 'Pending Reader',
          email: 'pending-parity@example.com',
          password: 'parity-password-123',
        },
      })
    ).user
    const repository = createAdminRepository(database.handle)
    const page = await repository.listUsers({ search: '', role: 'ALL', limit: 20, offset: 0 })
    expect(page.items.find((user) => user.id === buyer.id)?.emailVerified).toBe(true)
    expect(page.items.find((user) => user.id === pending.id)?.emailVerified).toBe(false)
    expect((await repository.getUser(pending.id)).emailVerified).toBe(false)
    await createSeedAccountStore(database.handle).markVerified(pending.id)
    expect((await repository.getUser(pending.id)).emailVerified).toBe(true)
  })

  it('verifies captured email, resets once and revokes old sessions on either provider', async () => {
    const messages: Array<{ text: string }> = []
    const app = await createApp(database.handle, {
      ...options,
      emailSender: {
        async send(message) {
          messages.push(message)
        },
      },
    })
    const post = (path: string, body: object) =>
      request(app).post(`/api/auth/${path}`).set('Origin', options.frontendOrigin).send(body)
    const credentials = { email: 'recovery-parity@example.com', password: 'parity-password-123' }
    const latest = () => new URL(messages.at(-1)!.text.match(/https?:\/\/[^\s]+/)![0])
    try {
      const signup = await post('sign-up/email', { name: 'Recovery Reader', ...credentials })
      expect(signup.body.token).toBeNull()
      expect((await post('sign-in/email', credentials)).status).toBe(403)
      let url = latest()
      expect((await request(app).get(url.pathname + url.search)).status).toBe(302)
      const login = await post('sign-in/email', credentials)
      expect(login.status).toBe(200)
      expect((await post('request-password-reset', { email: credentials.email })).status).toBe(200)
      url = latest()
      const token = url.pathname.split('/').at(-1)
      expect(
        (await post('reset-password', { token, newPassword: 'replacement-password-123' })).status,
      ).toBe(200)
      expect(
        (await post('reset-password', { token, newPassword: 'another-password-123' })).status,
      ).toBe(400)
      const viewer = await request(app)
        .post('/graphql')
        .set('Origin', options.frontendOrigin)
        .set('Cookie', login.headers['set-cookie'])
        .send({ query: '{ viewer { id } }' })
      expect(viewer.body.data.viewer).toBeNull()
    } finally {
      await app.locals.close()
    }
  })

  it('previews and revokes only unverified sessions without changing account, role or order data', async () => {
    const auth = createAuth(database.handle, options)
    const context = await auth.$context
    const old = (
      await auth.api.signUpEmail({
        body: {
          name: 'Old Admin',
          email: 'old-admin@example.com',
          password: 'rollout-password-123',
        },
      })
    ).user
    await createSeedAccountStore(database.handle).markVerified(old.id)
    const oldSession = await auth.api.signInEmail({
      body: { email: old.email, password: 'rollout-password-123' },
    })
    const verifiedSession = await auth.api.signInEmail({
      body: { email: buyer.email, password: 'parity-password-123' },
    })
    await createAdminRepository(database.handle).setUserRole(old.id, 'ADMIN', operatorActor)
    await service.createCheckout(input(), buyer)
    const orders = await store.orderPage(20, 0)
    await context.internalAdapter.updateUser(old.id, { emailVerified: false })
    expect(await revokeUnverifiedSessions(database.handle)).toEqual({
      unverifiedUsers: 1,
      sessions: 1,
    })
    expect(await context.internalAdapter.findSession(oldSession.token)).not.toBeNull()
    expect(await revokeUnverifiedSessions(database.handle, true)).toEqual({
      unverifiedUsers: 1,
      sessions: 1,
    })
    expect(await context.internalAdapter.findSession(oldSession.token)).toBeNull()
    expect(await context.internalAdapter.findSession(verifiedSession.token)).not.toBeNull()
    expect((await context.internalAdapter.findUserById(old.id))?.emailVerified).toBe(false)
    expect(await store.orderPage(20, 0)).toEqual(orders)
    expect(await store.role(old.id)).toBe('ADMIN')
  })

  it('reports current dashboard work and bounded previews without changing records', async () => {
    expect('dashboardWorkspace' in store).toBe(true)
    const { createDashboardService } = await import('../src/modules/dashboard/dashboard.service.js')
    const { createDashboardRepository } =
      await import('../src/modules/dashboard/dashboard.repository.js')
    for (const [index, stock] of [0, 1, 5, 6, 0].entries()) {
      await store.updateBook(index + 1, { stock, archived: index === 4 })
    }
    const ids: number[] = []
    for (let i = 0; i < 8; i++) {
      const row = await store.createOrder({
        customerName: 'Dashboard buyer',
        email: 'private@test.example',
        subtotalCents: 100,
        deliveryFeeCents: 0,
        totalCents: 100,
        status: 'SUBMITTED',
        paymentStatus: 'PAID',
        paidAt: '2026-10-09T01:00:00Z',
        createdAt: i % 2 ? '2026-10-09T01:00:00Z' : '2026-10-09 01:00:00',
      })
      ids.push(row.id)
    }
    await store.createOrder({
      customerName: 'Unpaid',
      email: 'private@test.example',
      subtotalCents: 100,
      deliveryFeeCents: 0,
      totalCents: 100,
    })
    const dashboard = createDashboardService(createDashboardRepository(database.handle), () =>
      Date.parse('2026-10-09T08:00:00Z'),
    )
    const result = await dashboard.workspace()
    expect(result.fulfillment.map((r) => r.count)).toEqual([8, 0, 0, 0])
    expect(result.awaitingPreparation.map((r) => r.id)).toEqual(ids.slice(0, 5).map(String))
    expect(result.recentOrders).toHaveLength(5)
    expect(result.recentOrders[1].id).toBe(String(ids[7]))
    expect(result.stockAlerts.map((r) => r.id)).toEqual(['1', '2', '3'])
    expect(result.lowStockCount).toBe(2)
    expect(result.outOfStockCount).toBe(1)
    expect(result.awaitingPreparation[0]).not.toHaveProperty('email')
    expect((await store.orderPage(20, 0)).total).toBe(9)
    expect((await store.book(1))!.stock).toBe(0)
  })

  it('reports exact daily captures and full refunds using Dubai boundaries on both providers', async () => {
    expect('dashboardFinance' in store).toBe(true)
    const { createDashboardService } = await import('../src/modules/dashboard/dashboard.service.js')
    const { createDashboardRepository } =
      await import('../src/modules/dashboard/dashboard.repository.js')
    const add = (paidAt: string | null, refundedAt: string | null, totalCents: number) =>
      store.createOrder({
        customerName: 'Finance buyer',
        email: 'private@test.example',
        subtotalCents: totalCents,
        deliveryFeeCents: 0,
        totalCents,
        paidAt,
        refundedAt,
        status: refundedAt ? 'CANCELLED' : 'SUBMITTED',
        paymentStatus: refundedAt ? 'REFUNDED' : paidAt ? 'PAID' : 'PENDING',
      })
    await add('2026-10-02T20:00:00Z', '2026-10-08T20:00:00Z', 2000000000)
    await add('2026-10-08T20:00:00Z', null, 2000000000)
    await add('2026-10-02T19:59:59.999Z', null, 50)
    await add('2026-10-09T20:00:00Z', null, 75)
    await add(null, null, 100)
    const failed = await add('2026-09-01T00:00:00Z', null, 25)
    await store.updateOrder(failed.id, { status: 'CANCELLED', paymentStatus: 'REFUND_FAILED' })
    const dashboard = createDashboardService(createDashboardRepository(database.handle), () =>
      Date.parse('2026-10-09T08:00:00Z'),
    )
    const result = await dashboard.finance('DAYS_7')
    expect(result).toMatchObject({
      startDate: '2026-10-03',
      endDate: '2026-10-09',
      capturedCents: '4000000000',
      refundedCents: '2000000000',
      netCents: '2000000000',
      paidOrderCount: 2,
      failedRefundCount: 1,
    })
    expect(result.days).toHaveLength(7)
    expect(result.days[0]).toEqual({
      date: '2026-10-03',
      capturedCents: '2000000000',
      refundedCents: '0',
      paidOrderCount: 1,
    })
    expect(result.days[1].capturedCents).toBe('0')
    expect(result.days[6]).toEqual({
      date: '2026-10-09',
      capturedCents: '2000000000',
      refundedCents: '2000000000',
      paidOrderCount: 1,
    })
    expect((await dashboard.finance('DAYS_30')).days).toHaveLength(30)
    expect((await dashboard.finance('DAYS_90')).days).toHaveLength(90)
    await store.updateOrder(2, { paidAt: '2026-09-01T00:00:00Z' })
    await store.updateOrder(1, { paidAt: '2026-09-01T00:00:00Z' })
    expect((await dashboard.finance('DAYS_7')).netCents).toBe('-2000000000')
    expect((await dashboard.finance('DAYS_7')).refundedCents).toBe('2000000000')
    await expect(dashboard.finance(null)).rejects.toThrow()
    const newYear = createDashboardService(createDashboardRepository(database.handle), () =>
      Date.parse('2026-12-31T20:00:00Z'),
    )
    expect(await newYear.finance('DAYS_7')).toMatchObject({
      startDate: '2026-12-26',
      endDate: '2027-01-01',
      capturedCents: '0',
    })
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
    const operation = (await repository.checkoutOperation(order.id))!
    expect(operation.id).toMatch(/^checkout:[0-9a-f-]{36}$/)
    const first = (await repository.claim(operation.id))!
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
      const operation = (await repository.checkoutOperation(order.id))!
      expect((await contender.checkoutOperation(order.id))!.id).toBe(operation.id)
      const claims = await Promise.all([
        repository.claim(operation.id),
        contender.claim(operation.id),
      ])
      expect(claims.filter(Boolean)).toHaveLength(1)
      expect((await repository.operation(operation.id))!.attempts).toBe(1)
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
