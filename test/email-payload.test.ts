import { expect, it } from 'vitest'
import { createEmailCrypto } from '../src/modules/email/email-payload.crypto.js'

const old = Buffer.alloc(32, 1).toString('base64')
const fresh = Buffer.alloc(32, 2).toString('base64')
const crypto = createEmailCrypto({ keys: { old }, activeKeyId: 'old' })
it('encrypts private payloads with random IVs and authenticates the full record context', () => {
  const payload = { to: 'reader@example.com', url: 'https://books.example/secret-token' }
  const sealed = crypto.seal('notification-id', 'VERIFY_EMAIL', payload)
  const row = {
    id: 'notification-id',
    kind: 'VERIFY_EMAIL' as const,
    templateVersion: 1,
    ...sealed,
  }
  expect(crypto.open(row)).toEqual(payload)
  expect(JSON.stringify(sealed)).not.toContain('reader@example.com')
  expect(crypto.seal(row.id, row.kind, payload).payloadIv).not.toBe(sealed.payloadIv)
  for (const patch of [
    { id: 'other' },
    { kind: 'RESET_PASSWORD' as const },
    { templateVersion: 2 },
    { payloadTag: Buffer.alloc(16).toString('base64') },
  ])
    expect(() => crypto.open({ ...row, ...patch })).toThrow('EMAIL_PAYLOAD_DECRYPTION_FAILED')
})
it('supports retained old keys on rotation and fails closed for unavailable or wrong keys', () => {
  const row = {
    id: 'id',
    kind: 'RESET_PASSWORD' as const,
    templateVersion: 1,
    ...crypto.seal('id', 'RESET_PASSWORD', {
      to: 'r@example.com',
      url: 'https://example.com/token',
    }),
  }
  expect(createEmailCrypto({ keys: { old, fresh }, activeKeyId: 'fresh' }).open(row).to).toBe(
    'r@example.com',
  )
  expect(() => createEmailCrypto({ keys: { fresh }, activeKeyId: 'fresh' }).open(row)).toThrow(
    'EMAIL_PAYLOAD_KEY_UNAVAILABLE',
  )
  expect(() => createEmailCrypto({ keys: { old: fresh }, activeKeyId: 'old' }).open(row)).toThrow(
    'EMAIL_PAYLOAD_DECRYPTION_FAILED',
  )
  expect(crypto.digest('private-token')).toMatch(/^[a-f0-9]{64}$/)
  expect(crypto.digest('private-token')).toBe(crypto.digest('private-token'))
})
it('rejects invalid key material before accepting work', () => {
  expect(() => createEmailCrypto({ keys: { bad: 'not-a-key' }, activeKeyId: 'bad' })).toThrow(
    'EMAIL_PAYLOAD_KEYS',
  )
  expect(() => createEmailCrypto({ keys: { old }, activeKeyId: 'missing' })).toThrow(
    'EMAIL_PAYLOAD_ACTIVE_KEY_ID',
  )
})
it('keeps event deduplication stable when payload encryption keys rotate', () => {
  const dedupeKey = Buffer.alloc(32, 3).toString('base64')
  const before = createEmailCrypto({ keys: { old }, activeKeyId: 'old', dedupeKey })
  const after = createEmailCrypto({ keys: { old, fresh }, activeKeyId: 'fresh', dedupeKey })
  expect(after.digest('VERIFY_EMAIL:reader@example.com:token')).toBe(
    before.digest('VERIFY_EMAIL:reader@example.com:token'),
  )
})
