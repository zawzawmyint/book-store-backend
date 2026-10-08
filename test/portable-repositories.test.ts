import { afterEach, describe, expect, it } from 'vitest'
import { createDatabase } from '../src/database/connection.js'
import { normalizeStore, serializedSQLiteOrm } from '../src/database/persistence.js'
import { createOrderRepository } from '../src/modules/orders/order.repository.js'
import { createPaymentRepository } from '../src/modules/payments/payment.repository.js'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { books, user } from '../src/database/schema.js'
const connections: ReturnType<typeof createDatabase>[] = []
afterEach(() => {
  for (const db of connections.splice(0)) db.close()
})
function fixture() {
  const db = createDatabase(':memory:')
  connections.push(db)
  const orm = drizzle(db)
  orm
    .insert(user)
    .values({
      id: 'buyer',
      name: 'Buyer',
      email: 'buyer@example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run()
  orm
    .insert(books)
    .values({
      id: 1,
      title: 'Portable',
      author: 'Author',
      genre: 'Test',
      description: 'Description',
      priceCents: 100,
      stock: 1,
    })
    .run()
  return {
    db,
    store: normalizeStore(db),
    customer: { id: 'buyer', name: 'Buyer', email: 'buyer@example.com' },
  }
}
describe('portable async repository guarantees', () => {
  it('rolls back the entire asynchronous transaction', async () => {
    const { store } = fixture()
    await expect(
      store.transaction(async (tx) => {
        await tx.adjustStock(1, -1)
        throw new Error('fault')
      }),
    ).rejects.toThrow('fault')
    expect((await store.book(1))?.stock).toBe(1)
  })
  it('serializes simultaneous final-unit reservations without overselling', async () => {
    const { db, store, customer } = fixture(),
      repo = createOrderRepository(db)
    const results = await Promise.allSettled([
      repo.saveOrder(customer, [{ bookId: '1', quantity: 1 }]),
      repo.saveOrder(customer, [{ bookId: '1', quantity: 1 }]),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect((await store.book(1))?.stock).toBe(0)
    expect((await store.orderPage(10, 0)).total).toBe(1)
  })
  it('shares the SQLite connection gate with authentication queries', async () => {
    const { db, store } = fixture(),
      orm = serializedSQLiteOrm(db, drizzle(db))
    let release!: () => void
    const pause = new Promise<void>((r) => {
      release = r
    })
    let started!: () => void
    const entered = new Promise<void>((r) => {
      started = r
    })
    const transaction = store.transaction(async (tx) => {
      await tx.adjustStock(1, -1)
      started()
      await pause
      throw new Error('rollback')
    })
    await entered
    const read = orm.select().from(books).execute()
    release()
    await expect(transaction).rejects.toThrow('rollback')
    expect((await read)[0].stock).toBe(1)
  })
  it('does not allow a stale lease owner to complete a newer worker claim', async () => {
    const { db, store, customer } = fixture()
    let now = 100000
    const repo = createPaymentRepository(db, () => now)
    const order = await repo.reserve(
      { items: [{ bookId: '1', quantity: 1 }], requestKey: 'same-key' },
      customer,
    )
    const old = await repo.claim(`checkout:${order.id}`)
    now += 30001
    const current = await repo.claim(`checkout:${order.id}`)
    expect(current?.leaseToken).not.toBe(old?.leaseToken)
    await repo.failOperation(old!, true)
    expect((await store.order(order.id))?.paymentStatus).toBe('PENDING')
    expect((await repo.operation(current!.id))?.leaseToken).toBe(current?.leaseToken)
  })
})
