import { expect, it, afterEach } from 'vitest'
import { classifySmtpFailure, createEmailConsumer } from '../src/modules/email/email-consumer.js'
import { createDatabase } from '../src/database/connection.js'
import { normalizeStore } from '../src/database/persistence.js'
import { createEmailCrypto } from '../src/modules/email/email-payload.crypto.js'
import { createEmailNotificationRepository } from '../src/modules/email/email-notification.repository.js'
import { randomUUID } from 'node:crypto'
import { createEmailDispatcher } from '../src/modules/email/email-dispatcher.js'

it('retries only clearly pre-submission transient failures and stops ambiguous sends', () => {
  expect(classifySmtpFailure({ code: 'ECONNECTION', command: 'CONN' })).toBe('RETRY')
  expect(classifySmtpFailure({ responseCode: 451, command: 'RCPT TO' })).toBe('RETRY')
  expect(classifySmtpFailure({ responseCode: 550, command: 'RCPT TO' })).toBe('FAILED')
  expect(classifySmtpFailure({ code: 'EENVELOPE', responseCode: 451, command: 'RCPT TO' })).toBe(
    'RETRY',
  )
  expect(classifySmtpFailure({ responseCode: 451, command: 'DATA' })).toBe('RETRY')
  expect(classifySmtpFailure({ code: 'ETIMEDOUT', command: 'DATA' })).toBe('UNCERTAIN')
  expect(classifySmtpFailure(new Error('private SMTP response'))).toBe('UNCERTAIN')
})

const databases: ReturnType<typeof createDatabase>[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})
async function fixture(auth = false) {
  const db = createDatabase(':memory:')
  databases.push(db)
  const crypto = createEmailCrypto({
    keys: { test: Buffer.alloc(32, 7).toString('base64') },
    activeKeyId: 'test',
  })
  const now = Date.now()
  const repo = createEmailNotificationRepository(db, crypto, () => now)
  const id = randomUUID()
  const kind = auth ? 'VERIFY_EMAIL' : 'ORDER_CONFIRMED'
  if (auth)
    db.exec("INSERT INTO user(id,name,email) VALUES ('reader','Reader','reader@example.com')")
  await normalizeStore(db).insertEmailNotification({
    id,
    dedupeKey: crypto.digest(id),
    kind,
    queue: auth ? 'AUTH' : 'ORDER',
    userId: auth ? 'reader' : null,
    createdAt: now,
    nextAttemptAt: now,
    ...crypto.seal(id, kind, {
      to: 'reader@example.com',
      url: 'https://store.example/verify',
      order: {
        id: 1,
        customerName: 'Reader',
        items: [],
        subtotalCents: 0,
        deliveryFeeCents: 0,
        totalCents: 0,
        currency: 'USD',
        eventAt: new Date(now).toISOString(),
        testPayment: true,
      },
    }),
  })
  return { db, crypto, repo, id, now }
}
it('concurrent consumers submit one email and terminal jobs do not send again', async () => {
  const f = await fixture()
  let sends = 0
  const consume = createEmailConsumer({
    repository: f.repo,
    crypto: f.crypto,
    sender: {
      async send() {
        sends++
      },
    },
    frontendOrigin: 'https://store.example',
    clock: () => f.now,
  })
  await Promise.all([consume(f.id), consume(f.id)])
  await consume(f.id)
  expect(sends).toBe(1)
  expect((await f.repo.get(f.id))?.status).toBe('SUBMITTED')
  expect((await f.repo.get(f.id))?.sendAttempts).toBe(1)
})
it('persists a transient retry budget and an ambiguous SMTP outcome stops for review', async () => {
  const f = await fixture()
  let now = f.now
  let sends = 0
  const consume = createEmailConsumer({
    repository: f.repo,
    crypto: f.crypto,
    sender: {
      async send() {
        sends++
        throw sends === 1
          ? { code: 'ECONNECTION', command: 'CONN' }
          : { code: 'ETIMEDOUT', command: 'DATA' }
      },
    },
    frontendOrigin: 'https://store.example',
    clock: () => now,
  })
  await consume(f.id)
  expect(await f.repo.get(f.id)).toMatchObject({
    status: 'PENDING',
    sendAttempts: 1,
    nextAttemptAt: now + 5000,
  })
  await consume(f.id)
  expect(sends).toBe(1)
  now += 5000
  await consume(f.id)
  expect(await f.repo.get(f.id)).toMatchObject({ status: 'UNCERTAIN', sendAttempts: 2 })
  now += 60000
  await consume(f.id)
  expect(sends).toBe(2)
})

it('retains the encrypted payload when eligibility lookup fails before SMTP', async () => {
  const f = await fixture()
  f.repo.authEligible = async () => {
    throw new Error('database unavailable')
  }
  let sends = 0
  await createEmailConsumer({
    repository: f.repo,
    crypto: f.crypto,
    sender: {
      async send() {
        sends++
      },
    },
    frontendOrigin: 'https://store.example',
    clock: () => f.now,
  })(f.id)
  const row = await f.repo.get(f.id)
  expect(row?.status).toBe('PENDING')
  expect(row?.lastErrorCode).toBe('EMAIL_ELIGIBILITY_UNAVAILABLE')
  expect(row?.payloadCiphertext).not.toBeNull()
  expect(sends).toBe(0)
})

it('preserves missing-key work without consuming its budget and delivers after key restoration', async () => {
  const f = await fixture(true)
  const rotated = createEmailCrypto({
    keys: { v2: Buffer.alloc(32, 9).toString('base64') },
    activeKeyId: 'v2',
  })
  let sends = 0
  const sender = {
    async send() {
      sends++
    },
  }
  await createEmailConsumer({
    repository: f.repo,
    crypto: rotated,
    sender,
    frontendOrigin: 'https://store.example',
    clock: () => f.now,
  })(f.id)
  expect(await f.repo.get(f.id)).toMatchObject({
    status: 'PENDING',
    lastErrorCode: 'EMAIL_PAYLOAD_KEY_UNAVAILABLE',
    sendAttempts: 0,
  })
  expect((await f.repo.get(f.id))?.payloadCiphertext).not.toBeNull()
  expect(sends).toBe(0)
  await expect(f.repo.assertKeysAvailable(['v2'])).rejects.toThrow('EMAIL_PAYLOAD_KEY_UNAVAILABLE')
  await f.repo.assertKeysAvailable(['test', 'v2'])
  await createEmailConsumer({
    repository: f.repo,
    crypto: f.crypto,
    sender,
    frontendOrigin: 'https://store.example',
    clock: () => f.now + 60000,
  })(f.id)
  expect((await f.repo.get(f.id))?.status).toBe('SUBMITTED')
  expect(sends).toBe(1)
})

it('blocks dispatch for a missing key but still expires its stale auth work', async () => {
  const f = await fixture(true)
  const tick = (now: number) => createEmailDispatcher(f.repo, {} as never, () => now, ['v2'])()
  await expect(tick(f.now)).rejects.toThrow('EMAIL_PAYLOAD_KEY_UNAVAILABLE')
  f.db.prepare('UPDATE email_notifications SET expires_at=? WHERE id=?').run(f.now + 120001, f.id)
  await tick(f.now + 120002)
  expect((await f.repo.get(f.id))?.status).toBe('EXPIRED')
  expect((await f.repo.get(f.id))?.payloadCiphertext).toBeNull()
})
