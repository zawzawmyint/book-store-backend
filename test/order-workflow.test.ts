import { afterEach, beforeEach, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { createDatabase } from '../src/database/connection.js'
import { seedBooks } from '../src/database/seed.js'
import { createOrderRepository } from '../src/modules/orders/order.repository.js'
import { createAdminOrderRepository } from '../src/modules/orders/admin-order.repository.js'
let db: Database.Database
beforeEach(() => {
  db = createDatabase(':memory:')
  seedBooks(db)
  db.exec("INSERT INTO user (id,name,email) VALUES ('buyer','Buyer','buyer@example.com')")
})
afterEach(() => db.close())
it('places a submitted request with a real owner timeline', async () => {
  const repository = createOrderRepository(db)
  const order = await repository.saveOrder(
    {
      id: 'buyer',
      name: 'Buyer',
      email: 'buyer@example.com',
    },
    [
      {
        bookId: '1',
        quantity: 2,
      },
    ],
  )
  expect(order).toMatchObject({
    status: 'SUBMITTED',
  })
  expect(
    db.prepare('SELECT from_status,to_status,actor_name,actor_role FROM order_status_events').all(),
  ).toEqual([
    {
      from_status: null,
      to_status: 'SUBMITTED',
      actor_name: 'Buyer',
      actor_role: 'CUSTOMER',
    },
  ])
})
it('cancels once with attributed history and restored stock while preserving snapshots', async () => {
  const repository = createOrderRepository(db)
  const order = await repository.saveOrder(
    {
      id: 'buyer',
      name: 'Buyer',
      email: 'buyer@example.com',
    },
    [
      {
        bookId: '1',
        quantity: 2,
      },
    ],
  )
  const workflow = createAdminOrderRepository(db)
  const before = db.prepare('SELECT stock FROM books WHERE id=1').get() as {
    stock: number
  }
  const actor = {
    source: 'GRAPHQL' as const,
    userId: 'buyer',
    name: 'Staff snapshot',
    role: 'STAFF' as const,
  }
  const input = {
    id: order.id,
    expectedStatus: 'SUBMITTED' as const,
    status: 'CANCELLED' as const,
    cancellationReason: 'Unavailable',
  }
  expect((await workflow.setStatus(input, actor)).status).toBe('CANCELLED')
  expect((await workflow.setStatus(input, actor)).status).toBe('CANCELLED')
  expect(db.prepare('SELECT stock FROM books WHERE id=1').get()).toEqual({
    stock: before.stock + 2,
  })
  expect(await workflow.history(order.id)).toHaveLength(2)
  expect(db.prepare('SELECT action FROM activity_events ORDER BY id').all()).toEqual([
    {
      action: 'BOOK_STOCK_ADJUSTED',
    },
    {
      action: 'ORDER_STATUS_CHANGED',
    },
  ])
})
async function placed() {
  return await createOrderRepository(db).saveOrder(
    {
      id: 'buyer',
      name: 'Buyer',
      email: 'buyer@example.com',
    },
    [
      {
        bookId: '1',
        quantity: 2,
      },
    ],
  )
}
const actor = {
  source: 'GRAPHQL' as const,
  userId: 'buyer',
  name: 'Staff snapshot',
  role: 'STAFF' as const,
}
it('enforces transitions, stale writes, terminal states and filter counts', async () => {
  const order = await placed(),
    workflow = createAdminOrderRepository(db)
  await expect(
    workflow.setStatus(
      {
        id: order.id,
        expectedStatus: 'SUBMITTED',
        status: 'COMPLETED',
      },
      actor,
    ),
  ).rejects.toThrow('not allowed')
  await workflow.setStatus(
    {
      id: order.id,
      expectedStatus: 'SUBMITTED',
      status: 'ACCEPTED',
    },
    actor,
  )
  await expect(
    workflow.setStatus(
      {
        id: order.id,
        expectedStatus: 'SUBMITTED',
        status: 'CANCELLED',
        cancellationReason: 'No',
      },
      actor,
    ),
  ).rejects.toThrow('status changed')
  await workflow.setStatus(
    {
      id: order.id,
      expectedStatus: 'ACCEPTED',
      status: 'COMPLETED',
    },
    actor,
  )
  await expect(
    workflow.setStatus(
      {
        id: order.id,
        expectedStatus: 'COMPLETED',
        status: 'ACCEPTED',
      },
      actor,
    ),
  ).rejects.toThrow('not allowed')
  expect((await workflow.list(1, 0, 'SUBMITTED')).total).toBe(0)
  expect((await workflow.list(1, 0, 'COMPLETED')).total).toBe(1)
  expect(await workflow.history(order.id)).toHaveLength(3)
})
it('restores duplicate saved quantities into archived books without changing snapshots', async () => {
  const order = await placed(),
    workflow = createAdminOrderRepository(db)
  db.prepare(
    "INSERT INTO order_items(order_id,book_id,title,quantity,unit_price_cents) VALUES (?,1,'Duplicate snapshot',3,11)",
  ).run(order.id)
  db.exec('UPDATE books SET stock=10,archived=1,price_cents=99 WHERE id=1')
  await workflow.setStatus(
    {
      id: order.id,
      expectedStatus: 'SUBMITTED',
      status: 'CANCELLED',
      cancellationReason: 'No',
    },
    actor,
  )
  expect(db.prepare('SELECT stock,archived FROM books WHERE id=1').get()).toEqual({
    stock: 15,
    archived: 1,
  })
  expect((await workflow.get(order.id))?.totalCents).toBe(order.totalCents)
  expect((await workflow.get(order.id))?.items[0].unitPriceCents).toBe(
    order.items[0].unitPriceCents,
  )
})
it.each(['order_status_events', 'activity_events', 'books'])(
  'rolls back cancellation when %s write fails',
  async (table) => {
    const order = await placed(),
      workflow = createAdminOrderRepository(db)
    const stock = db.prepare('SELECT stock FROM books WHERE id=1').get()
    db.exec(
      `CREATE TRIGGER reject_workflow BEFORE ${table === 'books' ? 'UPDATE' : 'INSERT'} ON ${table} BEGIN SELECT RAISE(ABORT,'injected failure'); END`,
    )
    await expect(
      workflow.setStatus(
        {
          id: order.id,
          expectedStatus: 'SUBMITTED',
          status: 'CANCELLED',
          cancellationReason: 'No',
        },
        actor,
      ),
    ).rejects.toThrow()
    expect((await workflow.get(order.id))?.status).toBe('SUBMITTED')
    expect(db.prepare('SELECT stock FROM books WHERE id=1').get()).toEqual(stock)
    expect(await workflow.history(order.id)).toHaveLength(1)
    expect(db.prepare('SELECT * FROM activity_events').all()).toEqual([])
  },
)
it('rejects unsupported stock and missing book references atomically', async () => {
  const order = await placed(),
    workflow = createAdminOrderRepository(db)
  db.exec('UPDATE books SET stock=1000000 WHERE id=1')
  await expect(
    workflow.setStatus(
      {
        id: order.id,
        expectedStatus: 'SUBMITTED',
        status: 'CANCELLED',
        cancellationReason: 'No',
      },
      actor,
    ),
  ).rejects.toThrow('limits')
  db.pragma('foreign_keys=OFF')
  db.exec('DELETE FROM books WHERE id=1')
  db.pragma('foreign_keys=ON')
  await expect(
    workflow.setStatus(
      {
        id: order.id,
        expectedStatus: 'SUBMITTED',
        status: 'CANCELLED',
        cancellationReason: 'No',
      },
      actor,
    ),
  ).rejects.toThrow('limits')
  expect((await workflow.get(order.id))?.status).toBe('SUBMITTED')
})
it('rolls back placement when its initial timeline fails', async () => {
  const stock = db.prepare('SELECT stock FROM books WHERE id=1').get()
  db.exec(
    "CREATE TRIGGER reject_event BEFORE INSERT ON order_status_events BEGIN SELECT RAISE(ABORT,'failure'); END",
  )
  await expect(placed()).rejects.toThrow()
  expect(db.prepare('SELECT * FROM orders').all()).toEqual([])
  expect(db.prepare('SELECT stock FROM books WHERE id=1').get()).toEqual(stock)
})
it('rejects quantities beyond the supported order bounds', async () => {
  const order = await placed(),
    workflow = createAdminOrderRepository(db)
  db.exec('UPDATE order_items SET quantity=11')
  await expect(
    workflow.setStatus(
      {
        id: order.id,
        expectedStatus: 'SUBMITTED',
        status: 'CANCELLED',
        cancellationReason: 'No',
      },
      actor,
    ),
  ).rejects.toThrow('quantity')
  expect((await workflow.get(order.id))?.status).toBe('SUBMITTED')
})
it('keeps actor snapshots after identity and role changes and actor deletion', async () => {
  const order = await placed(),
    workflow = createAdminOrderRepository(db)
  db.exec("INSERT INTO user(id,name,email) VALUES ('staff','Staff','staff@example.com')")
  await workflow.setStatus(
    {
      id: order.id,
      expectedStatus: 'SUBMITTED',
      status: 'ACCEPTED',
    },
    {
      ...actor,
      userId: 'staff',
    },
  )
  db.exec(
    "UPDATE user SET name='Renamed' WHERE id='staff'; INSERT INTO user_roles VALUES ('staff','ADMIN'); DELETE FROM user WHERE id='staff'",
  )
  expect((await workflow.history(order.id))[1]).toMatchObject({
    actorUserId: null,
    actorName: 'Staff snapshot',
    actorRole: 'STAFF',
  })
  expect(
    db
      .prepare(
        "SELECT actor_user_id,actor_name,actor_role FROM activity_events WHERE action='ORDER_STATUS_CHANGED'",
      )
      .get(),
  ).toEqual({
    actor_user_id: null,
    actor_name: 'Staff snapshot',
    actor_role: 'STAFF',
  })
})
it('filters all four states before stable pagination and counts', async () => {
  const workflow = createAdminOrderRepository(db)
  const ids = await Promise.all(
    Array.from(
      {
        length: 5,
      },
      async () => (await placed()).id,
    ),
  )
  for (const id of ids.slice(1))
    await workflow.setStatus(
      {
        id,
        expectedStatus: 'SUBMITTED',
        status: 'ACCEPTED',
      },
      actor,
    )
  await workflow.setStatus(
    {
      id: ids[2],
      expectedStatus: 'ACCEPTED',
      status: 'COMPLETED',
    },
    actor,
  )
  await workflow.setStatus(
    {
      id: ids[3],
      expectedStatus: 'ACCEPTED',
      status: 'CANCELLED',
      cancellationReason: 'No',
    },
    actor,
  )
  expect((await workflow.list(1, 0, 'ALL')).total).toBe(5)
  expect((await workflow.list(1, 0, 'SUBMITTED')).items.map((row) => row.id)).toEqual([ids[0]])
  expect((await workflow.list(1, 0, 'ACCEPTED')).total).toBe(2)
  expect((await workflow.list(1, 0, 'ACCEPTED')).items.map((row) => row.id)).toEqual([ids[4]])
  expect((await workflow.list(1, 1, 'ACCEPTED')).items.map((row) => row.id)).toEqual([ids[1]])
  expect((await workflow.list(1, 0, 'COMPLETED')).items.map((row) => row.id)).toEqual([ids[2]])
  expect((await workflow.list(1, 0, 'CANCELLED')).items.map((row) => row.id)).toEqual([ids[3]])
})
