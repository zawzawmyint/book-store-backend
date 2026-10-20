import { createPaymentRepository } from '../src/modules/payments/payment.repository.js'
import { expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { DomainStore } from '../src/database/store.types.js'
import { createNotificationStore } from '../src/modules/notifications/notification.writer.js'
import {
  createNotificationRepository,
  cleanupNotifications,
} from '../src/modules/notifications/notification.repository.js'
/** Same durable contract runs against migrated SQLite and disposable PostgreSQL. */
export async function verifyNotificationContract(
  base: DomainStore,
  buyer: { id: string; name: string; email: string },
) {
  await base.setRole(buyer.id, 'ADMIN')
  const hints: unknown[] = [],
    store = createNotificationStore(base, {
      enabled: true,
      publish: async (hint) => {
        hints.push(hint)
      },
    }),
    repo = createNotificationRepository(store)
  const order = await store.createOrder({
    userId: buyer.id,
    customerName: buyer.name,
    email: buyer.email,
    subtotalCents: 100,
    deliveryFeeCents: 0,
    totalCents: 100,
  })
  await expect(
    store.transaction(async (tx) => {
      await tx.updateOrder(order.id, { paymentStatus: 'PAID' })
      throw Error('abort')
    }),
  ).rejects.toThrow('abort')
  expect(await repo.unreadCount(buyer.id, 'STOREFRONT')).toBe(0)
  expect(hints).toHaveLength(0)
  await store.transaction((tx) => tx.updateOrder(order.id, { paymentStatus: 'PAID' }))
  await store.transaction((tx) => tx.updateOrder(order.id, { paymentStatus: 'PAID' }))
  expect(await repo.unreadCount(buyer.id, 'STOREFRONT')).toBe(1)
  expect(await repo.unreadCount(buyer.id, 'WORKSPACE')).toBe(1)
  expect(hints).toHaveLength(2)
  for (const status of ['PREPARING', 'SHIPPED', 'DELIVERED'] as const)
    await store.transaction((tx) => tx.updateOrder(order.id, { status }))
  const first = await repo.list(buyer.id, 'STOREFRONT', { first: 2 }),
    second = await repo.list(buyer.id, 'STOREFRONT', { first: 2, after: first.pageInfo.endCursor })
  expect(first.pageInfo.hasNextPage).toBe(true)
  expect(second.nodes).toHaveLength(2)
  expect(new Set([...first.nodes, ...second.nodes].map((r) => r.id)).size).toBe(4)
  const read = await repo.read(buyer.id, 'STOREFRONT', String(first.nodes[0]!.id))
  expect((await repo.read(buyer.id, 'STOREFRONT', String(read.id))).readAt).toBe(read.readAt)
  expect((await repo.readAll(buyer.id, 'STOREFRONT')).changedCount).toBe(3)
  const cancelled = await store.createOrder({
    userId: buyer.id,
    customerName: buyer.name,
    email: buyer.email,
    subtotalCents: 100,
    deliveryFeeCents: 0,
    totalCents: 100,
  })
  await store.transaction((tx) => tx.updateOrder(cancelled.id, { status: 'CANCELLED' }))
  // Late payment gets a receipt, but never creates actionable workspace order.
  await store.transaction(async (tx) => {
    await tx.updateOrder(cancelled.id, { paymentStatus: 'PAID' })
    await tx.updateOrder(cancelled.id, { paymentStatus: 'REFUND_PENDING' })
  })
  expect(await repo.unreadCount(buyer.id, 'WORKSPACE')).toBe(1)
  const paymentRepository = createPaymentRepository(store, () => Date.now())
  const episodeIds = [`refund:${randomUUID()}`, `refund:${randomUUID()}`]
  // Both operations exist before either failure; row ordering cannot identify the active one.
  for (const id of episodeIds)
    await store.insertOperation({
      id,
      orderId: cancelled.id,
      kind: 'REFUND',
      createdAt: Date.now(),
      retryAt: 0,
    })
  for (const id of episodeIds) {
    await store.transaction((tx) =>
      tx.updateOrder(cancelled.id, { paymentStatus: 'REFUND_PENDING', stripeRefundId: null }),
    )
    const claimed = await paymentRepository.claim(id)
    expect(claimed).toBeTruthy()
    await paymentRepository.failOperation(claimed!, true)
    await paymentRepository.failOperation(claimed!, true)
  }
  expect(
    (await repo.list(buyer.id, 'WORKSPACE', {})).nodes.filter((n) => n.kind === 'REFUND_FAILED'),
  ).toHaveLength(2)
  await store.setRole(buyer.id, 'STAFF')
  expect(await repo.unreadCount(buyer.id, 'WORKSPACE')).toBe(1)
  await store.setRole(buyer.id, 'CUSTOMER')
  await expect(repo.unreadCount(buyer.id, 'WORKSPACE')).rejects.toMatchObject({
    extensions: { code: 'FORBIDDEN' },
  })
  await store.setRole(buyer.id, 'ADMIN')
  await store.transaction((tx) => tx.updateOrder(cancelled.id, { paymentStatus: 'REFUNDED' }))
  expect(
    (await repo.list(buyer.id, 'STOREFRONT', {})).nodes.some((n) => n.kind === 'REFUND_COMPLETED'),
  ).toBe(true)
  const book = (await store.book(1))!
  await store.transaction((tx) => tx.adjustStock(1, 5 - book.stock))
  await store.transaction((tx) => tx.adjustStock(1, -1))
  await store.transaction((tx) => tx.adjustStock(1, -4))
  expect(
    (await repo.list(buyer.id, 'WORKSPACE', {})).nodes.filter((n) =>
      ['STOCK_LOW', 'STOCK_OUT'].includes(n.kind),
    ),
  ).toHaveLength(2)
  const now = Date.now(),
    cutoff = new Date(now - 90 * 86400000).toISOString()
  for (const createdAt of [cutoff, new Date(Date.parse(cutoff) - 1).toISOString()])
    await store.insertInAppNotification({
      id: randomUUID(),
      eventKey: createdAt,
      recipientId: buyer.id,
      scope: 'STOREFRONT',
      kind: 'ORDER_ACCEPTED',
      requiredRole: 'VERIFIED',
      resourceType: 'ORDER',
      resourceId: '1',
      payload: '{"version":1,"testPayment":false}',
      createdAt,
    })
  expect((await cleanupNotifications(store, now)).deleted).toBe(1)
}
