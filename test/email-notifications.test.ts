import { afterEach, beforeEach, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createDatabase } from '../src/database/connection.js'
import { normalizeStore } from '../src/database/persistence.js'

let db: ReturnType<typeof createDatabase>
let store: ReturnType<typeof normalizeStore>
beforeEach(() => {
  db = createDatabase(':memory:')
  store = normalizeStore(db)
})
afterEach(() => db.close())
const draft = () => ({
  id: randomUUID(),
  dedupeKey: randomUUID(),
  kind: 'VERIFY_EMAIL' as const,
  queue: 'AUTH' as const,
  createdAt: 1000,
  nextAttemptAt: 1000,
  expiresAt: 3601000,
})

it('persists a unique durable notification and rolls back transaction writes', async () => {
  const row = draft()
  await store.insertEmailNotification(row)
  await store.insertEmailNotification({ ...row, id: randomUUID() })
  expect((await store.emailNotification(row.id))?.status).toBe('PENDING')
  expect(await store.dueEmailNotifications(1000, 50)).toHaveLength(1)
  const rolledBack = draft()
  await expect(
    store.transaction(async (tx) => {
      await tx.insertEmailNotification(rolledBack)
      throw new Error('rollback')
    }),
  ).rejects.toThrow('rollback')
  expect(await store.emailNotification(rolledBack.id)).toBeUndefined()
})

it('allows only one dispatch owner and rejects updates from a stale lease', async () => {
  const row = draft()
  await store.insertEmailNotification(row)
  const token = randomUUID()
  const claims = await Promise.all([
    store.claimEmailDispatch(row.id, 1000, token),
    store.claimEmailDispatch(row.id, 1000, randomUUID()),
  ])
  expect(claims.filter(Boolean)).toHaveLength(1)
  expect(await store.updateEmailNotification(row.id, { status: 'ENQUEUED' }, 'stale')).toBe(false)
  expect(await store.updateEmailNotification(row.id, { status: 'ENQUEUED' }, token)).toBe(true)
})

it('does not let dispatcher acknowledgement overwrite a consumer result', async () => {
  const row = draft()
  await store.insertEmailNotification(row)
  const dispatchToken = randomUUID()
  await store.claimEmailDispatch(row.id, 1000, dispatchToken)
  const send = await store.claimEmailSend(row.id, 1000, randomUUID())
  expect(send?.sendAttempts).toBe(1)
  expect(await store.updateEmailNotification(row.id, { status: 'ENQUEUED' }, dispatchToken)).toBe(
    false,
  )
  expect((await store.emailNotification(row.id))?.status).toBe('SENDING')
})

it('keeps recently enqueued work out of the reconciliation batch without delaying sends', async () => {
  const row = draft()
  await store.insertEmailNotification(row)
  const token = randomUUID()
  await store.claimEmailDispatch(row.id, 1000, token)
  await store.updateEmailNotification(
    row.id,
    { status: 'ENQUEUED', enqueuedAt: 1000, leaseUntil: null, leaseToken: null },
    token,
  )
  expect(await store.dueEmailNotifications(1001, 50)).toHaveLength(0)
  expect(await store.dueEmailNotifications(31000, 50)).toHaveLength(1)
  expect((await store.claimEmailSend(row.id, 1001, randomUUID()))?.status).toBe('SENDING')
})
