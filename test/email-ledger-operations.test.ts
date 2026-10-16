import { afterEach, beforeEach, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createDatabase } from '../src/database/connection.js'
import { normalizeStore } from '../src/database/persistence.js'
import { createEmailCrypto } from '../src/modules/email/email-payload.crypto.js'
import { createEmailNotificationRepository } from '../src/modules/email/email-notification.repository.js'

let db: ReturnType<typeof createDatabase>
const crypto = createEmailCrypto({
  keys: { v1: Buffer.alloc(32, 7).toString('base64') },
  activeKeyId: 'v1',
})
const now = 1700000000000
beforeEach(() => {
  db = createDatabase(':memory:')
})
afterEach(() => db.close())
async function seed(
  status: 'FAILED' | 'UNCERTAIN' | 'SUBMITTED' | 'PENDING',
  queue: 'AUTH' | 'ORDER' = 'ORDER',
) {
  const id = randomUUID(),
    kind = queue === 'ORDER' ? ('ORDER_CONFIRMED' as const) : ('VERIFY_EMAIL' as const)
  await normalizeStore(db).insertEmailNotification({
    id,
    dedupeKey: id,
    kind,
    queue,
    status,
    createdAt: now,
    nextAttemptAt: now,
    terminalAt: status === 'PENDING' ? null : now,
    expiresAt: queue === 'AUTH' ? now + 3600000 : null,
    ...crypto.seal(id, kind, {
      to: 'private@example.com',
      url: 'https://store.example/private-token',
    }),
  })
  return id
}

it('previews replay without writes and requires duplicate-risk acknowledgement for uncertainty', async () => {
  const id = await seed('UNCERTAIN')
  const repo = createEmailNotificationRepository(db, crypto, () => now)
  await expect(repo.replay(id, false, true)).rejects.toThrow('ACK_REQUIRED')
  expect(await repo.replay(id, true, false)).toMatchObject({ applied: false })
  expect(db.prepare('SELECT COUNT(*) AS n FROM email_notifications').get()).toEqual({ n: 1 })
  const replay = await repo.replay(id, true, true)
  expect(replay.applied).toBe(true)
  expect((await repo.get(id))?.status).toBe('UNCERTAIN')
  expect((await repo.due(now))[0].replayOfId).toBe(id)
  expect(JSON.stringify(await repo.inspect(id))).not.toMatch(/private|payload|token/)
})

it('rejects replay of submitted and pending notifications', async () => {
  const repo = createEmailNotificationRepository(db, crypto, () => now)
  for (const status of ['SUBMITTED', 'PENDING'] as const)
    await expect(repo.replay(await seed(status), true, true)).rejects.toThrow('UNAVAILABLE')
})

it('purges auth secrets immediately, order payload after seven days, and metadata after ninety', async () => {
  const repo = createEmailNotificationRepository(db, crypto, () => now)
  const auth = await seed('FAILED', 'AUTH'),
    order = await seed('SUBMITTED')
  await repo.cleanup(now)
  expect((await repo.get(auth))?.payloadCiphertext).toBeNull()
  expect((await repo.get(order))?.payloadCiphertext).toBeTruthy()
  await repo.cleanup(now + 7 * 86400000)
  expect((await repo.get(order))?.payloadCiphertext).toBeNull()
  expect(await repo.get(order)).toBeDefined()
  await repo.cleanup(now + 90 * 86400000)
  expect(await repo.get(order)).toBeUndefined()
})

it('enforces the durable auth send budget across new claims', async () => {
  const repo = createEmailNotificationRepository(db, crypto, () => now)
  const id = await seed('PENDING', 'AUTH')
  let clock = now
  for (let attempt = 1; attempt <= 4; attempt++) {
    const token = randomUUID()
    expect((await repo.claimSend(id, clock, token))?.sendAttempts).toBe(attempt)
    await repo.retry(id, token, clock, 'SMTP_TRANSIENT')
    clock += 5000 * 2 ** (attempt - 1)
  }
  expect((await repo.get(id))?.status).toBe('FAILED')
  expect((await repo.get(id))?.payloadCiphertext).toBeNull()
  expect(await repo.claimSend(id, clock, randomUUID())).toBeUndefined()
})
