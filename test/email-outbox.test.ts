import { afterEach, expect, it } from 'vitest'
import { createDatabase } from '../src/database/connection.js'
import { normalizeStore } from '../src/database/persistence.js'
import { createEmailCrypto } from '../src/modules/email/email-payload.crypto.js'
import { createEmailOutboxWriter } from '../src/modules/email/email-outbox.writer.js'
import { createEmailNotificationRepository } from '../src/modules/email/email-notification.repository.js'
import { randomUUID } from 'node:crypto'

const db = createDatabase(':memory:')
const store = normalizeStore(db)
const crypto = createEmailCrypto({
  keys: { v1: Buffer.alloc(32, 7).toString('base64') },
  activeKeyId: 'v1',
})
const now = 1700000000000
const writer = createEmailOutboxWriter(db, crypto, () => now)
afterEach(() => db.prepare('DELETE FROM email_notifications').run())
const url = `https://store.example/api/auth/verify-email?token=${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ exp: now / 1000 + 3600 })).toString('base64url')}.signature`

it('durably records the exact auth URL and deduplicates the same token', async () => {
  const input = {
    kind: 'VERIFY_EMAIL' as const,
    userId: 'u1',
    to: 'reader@example.com',
    url,
    token: new URL(url).searchParams.get('token')!,
  }
  const id = await writer.enqueueAuthEmail(input)
  expect(await writer.enqueueAuthEmail(input)).toBe(id)
  const row = (await store.emailNotification(id))!
  expect(row.expiresAt).toBe(now + 3600000)
  expect(crypto.open(row).url).toBe(url)
  expect(JSON.stringify(row)).not.toContain('reader@example.com')
  expect(JSON.stringify(row)).not.toContain('signature')
})

it('retains the retry budget and stops uncertain sends after a lost worker', async () => {
  const id = await writer.enqueueAuthEmail({
    kind: 'VERIFY_EMAIL',
    userId: 'u1',
    to: 'reader@example.com',
    url,
    token: new URL(url).searchParams.get('token')!,
  })
  const repo = createEmailNotificationRepository(db, crypto, () => now)
  const token = randomUUID()
  await repo.claimSend(id, now, token)
  await repo.retry(id, token, now, 'SMTP_TRANSIENT')
  expect((await repo.get(id))?.sendAttempts).toBe(1)
  expect(await repo.claimSend(id, now, randomUUID())).toBeUndefined()
  await repo.claimSend(id, now + 5000, randomUUID())
  await repo.recover(now + 65001)
  expect((await repo.get(id))?.status).toBe('UNCERTAIN')
  expect((await repo.get(id))?.payloadCiphertext).toBeNull()
  expect(await repo.claimSend(id, now + 66000, randomUUID())).toBeUndefined()
})

it('expires auth work before the final two minutes and never submits it', async () => {
  const id = await writer.enqueueAuthEmail({
    kind: 'VERIFY_EMAIL',
    userId: 'u1',
    to: 'reader@example.com',
    url,
    token: new URL(url).searchParams.get('token')!,
  })
  const repo = createEmailNotificationRepository(db, crypto)
  await repo.recover(now + 3480000)
  expect((await repo.get(id))?.status).toBe('EXPIRED')
  expect((await repo.get(id))?.payloadCiphertext).toBeNull()
})

it('rejects an SMTP completion after its send lease has expired', async () => {
  const id = await writer.enqueueAuthEmail({
    kind: 'VERIFY_EMAIL',
    userId: 'u1',
    to: 'reader@example.com',
    url,
    token: new URL(url).searchParams.get('token')!,
  })
  const repo = createEmailNotificationRepository(db, crypto, () => now)
  const token = randomUUID()
  await repo.claimSend(id, now, token)
  expect(await repo.finish(id, token, 'SUBMITTED', now + 60001)).toBe(false)
  await repo.recover(now + 60001)
  expect((await repo.get(id))?.status).toBe('UNCERTAIN')
})

it('rejects automatic retry by an expired send owner', async () => {
  const id = await writer.enqueueAuthEmail({
    kind: 'VERIFY_EMAIL',
    userId: 'u1',
    to: 'reader@example.com',
    url,
    token: new URL(url).searchParams.get('token')!,
  })
  const repo = createEmailNotificationRepository(db, crypto, () => now)
  const token = randomUUID()
  await repo.claimSend(id, now, token)
  expect(await repo.retry(id, token, now + 60001, 'SMTP_TRANSIENT')).toBe(false)
  await repo.recover(now + 60001)
  expect((await repo.get(id))?.status).toBe('UNCERTAIN')
})
