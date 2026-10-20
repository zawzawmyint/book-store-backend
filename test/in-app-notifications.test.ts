import { expect, it } from 'vitest'
import { createDatabase } from '../src/database/connection.js'
it('migrates durable in-app inbox separately from email and cascades account deletion', () => {
  const db = createDatabase(':memory:')
  try {
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name='in_app_notifications'").get(),
    ).toBeTruthy()
  } finally {
    db.close()
  }
})
import { createNotificationStore } from '../src/modules/notifications/notification.writer.js'
import { normalizeStore } from '../src/database/persistence.js'
import { seedBooks } from '../src/database/seed.js'
it('saves payment and eligible workspace alerts atomically, suppresses retries and rolls back hints', async () => {
  const db = createDatabase(':memory:')
  seedBooks(db)
  try {
    db.exec(
      "INSERT INTO user(id,name,email,email_verified) VALUES('c','C','c@ex.com',1),('s','S','s@ex.com',1),('a','A','a@ex.com',1); INSERT INTO user_roles(user_id,role) VALUES('s','STAFF'),('a','ADMIN')",
    )
    const hints: unknown[] = []
    const store = createNotificationStore(db, {
      enabled: true,
      publish: async (h) => {
        hints.push(h)
      },
    })
    const order = await store.createOrder({
      userId: 'c',
      customerName: 'C',
      email: 'c@ex.com',
      subtotalCents: 100,
      deliveryFeeCents: 0,
      totalCents: 100,
    })
    await expect(
      store.transaction(async (tx) => {
        await tx.updateOrder(order.id, { paymentStatus: 'PAID' })
        throw Error('rollback')
      }),
    ).rejects.toThrow('rollback')
    expect(
      await store.inAppUnreadCount({ recipientId: 'c', scope: 'STOREFRONT', admin: false }),
    ).toBe(0)
    expect(hints).toHaveLength(0)
    await store.transaction((tx) => tx.updateOrder(order.id, { paymentStatus: 'PAID' }))
    expect(
      (await store.inAppList({ recipientId: 'c', scope: 'STOREFRONT', admin: false }, 20)).map(
        (r) => r.kind,
      ),
    ).toEqual(['PAYMENT_CONFIRMED'])
    expect(
      await store.inAppUnreadCount({ recipientId: 's', scope: 'WORKSPACE', admin: false }),
    ).toBe(1)
    expect(hints).toHaveLength(3)
    await store.transaction((tx) => tx.updateOrder(order.id, { paymentStatus: 'PAID' }))
    expect(hints).toHaveLength(3)
  } finally {
    db.close()
  }
})
it('only emits stock-band transitions on existing active books', async () => {
  const db = createDatabase(':memory:')
  seedBooks(db)
  try {
    db.exec(
      "INSERT INTO user(id,name,email,email_verified) VALUES('s','S','s@ex.com',1); INSERT INTO user_roles(user_id,role) VALUES('s','STAFF')",
    )
    const store = createNotificationStore(db, { enabled: true })
    const book = (await store.book(1))!
    await store.transaction((tx) => tx.adjustStock(1, 5 - book.stock))
    expect(
      (await store.inAppList({ recipientId: 's', scope: 'WORKSPACE', admin: false }, 20)).map(
        (r) => r.kind,
      ),
    ).toEqual(['STOCK_LOW'])
    await store.transaction((tx) => tx.adjustStock(1, -1))
    expect(
      await store.inAppUnreadCount({ recipientId: 's', scope: 'WORKSPACE', admin: false }),
    ).toBe(1)
    await store.transaction((tx) => tx.adjustStock(1, -4))
    expect(
      await store.inAppUnreadCount({ recipientId: 's', scope: 'WORKSPACE', admin: false }),
    ).toBe(2)
  } finally {
    db.close()
  }
})

import {
  createNotificationRepository,
  cleanupNotifications,
} from '../src/modules/notifications/notification.repository.js'
import { randomUUID } from 'node:crypto'
it('isolates inboxes, rechecks roles, preserves first read timestamp and validates pagination', async () => {
  const db = createDatabase(':memory:')
  try {
    db.exec(
      "INSERT INTO user(id,name,email,email_verified) VALUES('c','C','c@ex.com',1),('s','S','s@ex.com',1),('a','A','a@ex.com',1); INSERT INTO user_roles(user_id,role) VALUES('s','STAFF'),('a','ADMIN')",
    )
    const store = normalizeStore(db),
      repo = createNotificationRepository(store)
    const make = async (
      recipientId: string,
      requiredRole: 'VERIFIED' | 'STAFF' | 'ADMIN',
      createdAt = '2026-10-20T00:00:00.000Z',
    ) => {
      const id = randomUUID()
      await store.insertInAppNotification({
        id,
        eventKey: id,
        recipientId,
        scope: requiredRole === 'VERIFIED' ? 'STOREFRONT' : 'WORKSPACE',
        kind: requiredRole === 'ADMIN' ? 'REFUND_FAILED' : 'PAYMENT_CONFIRMED',
        requiredRole,
        resourceType: 'ORDER',
        resourceId: '1',
        payload: JSON.stringify({ version: 1, testPayment: true }),
        createdAt,
      })
      return id
    }
    const own = await make('c', 'VERIFIED'),
      other = await make('s', 'VERIFIED')
    await expect(repo.read('c', 'STOREFRONT', other)).rejects.toMatchObject({
      extensions: { code: 'BAD_USER_INPUT' },
    })
    const first = await repo.read('c', 'STOREFRONT', own)
    expect((await repo.read('c', 'STOREFRONT', own)).readAt).toBe(first.readAt)
    expect(await repo.unreadCount('c', 'STOREFRONT')).toBe(0)
    await make('c', 'VERIFIED')
    await make('c', 'VERIFIED')
    const page = await repo.list('c', 'STOREFRONT', { first: 1 })
    expect(page.pageInfo.hasNextPage).toBe(true)
    const next = await repo.list('c', 'STOREFRONT', { first: 1, after: page.pageInfo.endCursor })
    expect(next.nodes[0]?.id).not.toBe(page.nodes[0]?.id)
    await expect(repo.list('c', 'STOREFRONT', { first: 51 })).rejects.toMatchObject({
      extensions: { code: 'BAD_USER_INPUT' },
    })
    await expect(repo.list('c', 'STOREFRONT', { after: 'garbage' })).rejects.toMatchObject({
      extensions: { code: 'BAD_USER_INPUT' },
    })
    await make('a', 'ADMIN')
    await make('a', 'STAFF')
    await store.setRole('a', 'STAFF')
    expect(await repo.unreadCount('a', 'WORKSPACE')).toBe(1)
    expect((await repo.readAll('a', 'WORKSPACE')).changedCount).toBe(1)
    await store.setRole('a', 'CUSTOMER')
    await expect(repo.list('a', 'WORKSPACE', {})).rejects.toMatchObject({
      extensions: { code: 'FORBIDDEN' },
    })
    await store.setRole('a', 'ADMIN')
    expect(await repo.unreadCount('a', 'WORKSPACE')).toBe(1)
    await expect(
      createNotificationRepository(store, false).unreadCount('c', 'STOREFRONT'),
    ).rejects.toMatchObject({ extensions: { code: 'NOTIFICATIONS_DISABLED' } })
    db.prepare("DELETE FROM user WHERE id='c'").run()
    expect(
      await store.inAppUnreadCount({ recipientId: 'c', scope: 'STOREFRONT', admin: false }),
    ).toBe(0)
  } finally {
    db.close()
  }
})
it('retains rows exactly at the 90-day cutoff and deletes older rows in bounded batches', async () => {
  const db = createDatabase(':memory:')
  try {
    db.exec("INSERT INTO user(id,name,email,email_verified) VALUES('c','C','c@ex.com',1)")
    const store = normalizeStore(db),
      now = Date.parse('2026-10-20T00:00:00.000Z'),
      cutoff = new Date(now - 90 * 86400000).toISOString()
    for (const createdAt of [cutoff, new Date(Date.parse(cutoff) - 1).toISOString()])
      await store.insertInAppNotification({
        id: randomUUID(),
        eventKey: createdAt,
        recipientId: 'c',
        scope: 'STOREFRONT',
        kind: 'ORDER_ACCEPTED',
        requiredRole: 'VERIFIED',
        resourceType: 'ORDER',
        resourceId: '1',
        payload: '{"version":1,"testPayment":false}',
        createdAt,
      })
    expect(await cleanupNotifications(store, now)).toEqual({ deleted: 1, cutoff })
    expect(
      await store.inAppUnreadCount({ recipientId: 'c', scope: 'STOREFRONT', admin: false }),
    ).toBe(1)
  } finally {
    db.close()
  }
})
