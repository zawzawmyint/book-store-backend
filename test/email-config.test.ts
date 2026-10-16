import { expect, it } from 'vitest'
import { loadEmailConfig } from '../src/modules/email/email-config.js'
import { loadConfig } from '../src/config/env.js'

const keys = {
  EMAIL_QUEUE_PREFIX: 'book-store-production-test',
  EMAIL_PAYLOAD_KEYS: JSON.stringify({ v1: Buffer.alloc(32, 7).toString('base64') }),
  EMAIL_PAYLOAD_ACTIVE_KEY_ID: 'v1',
  EMAIL_DEDUPE_KEY: Buffer.alloc(32, 8).toString('base64'),
}
it('defaults inline outside production and requires durable mode and keys in production', () => {
  expect(loadEmailConfig({}).mode).toBe('inline')
  expect(() => loadEmailConfig({ NODE_ENV: 'production', EMAIL_DELIVERY_MODE: 'inline' })).toThrow(
    'queued',
  )
  expect(() => loadEmailConfig({ NODE_ENV: 'production' })).toThrow('EMAIL_PAYLOAD_KEYS')
  expect(loadEmailConfig({ NODE_ENV: 'production', ...keys })).toMatchObject({
    mode: 'queued',
    authConcurrency: 2,
    orderConcurrency: 2,
    healthPort: 4010,
  })
})
it('allows queued API without Redis while worker requires authenticated TLS Redis in production', () => {
  expect(loadEmailConfig({ NODE_ENV: 'production', ...keys }).redisUrl).toBeUndefined()
  expect(() => loadEmailConfig({ NODE_ENV: 'production', ...keys }, 'worker')).toThrow('REDIS_URL')
  for (const url of [
    'redis://:secret@redis.example:6379',
    'rediss://redis.example:6379',
    'rediss://:secret@redis.example:6379?rejectUnauthorized=false',
  ])
    expect(() =>
      loadEmailConfig({ NODE_ENV: 'production', ...keys, REDIS_URL: url }, 'worker'),
    ).toThrow('REDIS_URL')
  expect(
    loadEmailConfig(
      { NODE_ENV: 'production', ...keys, REDIS_URL: 'rediss://:secret@redis.example:6379' },
      'worker',
    ).mode,
  ).toBe('queued')
})
it('rejects malformed queue settings and keeps order emails opt-in', () => {
  expect(() =>
    loadEmailConfig({ NODE_ENV: 'production', ...keys, EMAIL_QUEUE_PREFIX: undefined }),
  ).toThrow('EMAIL_QUEUE_PREFIX')
  for (const values of [
    { EMAIL_AUTH_CONCURRENCY: '0' },
    { EMAIL_ORDER_CONCURRENCY: '101' },
    { EMAIL_QUEUE_PREFIX: 'bad:prefix' },
    { EMAIL_ORDER_NOTIFICATIONS_ENABLED: 'yes' },
    { EMAIL_DELIVERY_MODE: 'invalid' },
    { EMAIL_WORKER_HEALTH_PORT: '65536' },
  ])
    expect(() => loadEmailConfig(values)).toThrow()
  expect(loadEmailConfig({}).orderNotificationsEnabled).toBe(false)
})
it('does not require SMTP credentials in a production queued API but requires them for a worker', () => {
  const production = {
    NODE_ENV: 'production',
    EMAIL_DELIVERY_MODE: 'queued',
    BETTER_AUTH_SECRET: 'a'.repeat(32),
    BETTER_AUTH_URL: 'https://books.example',
    FRONTEND_ORIGIN: 'https://books.example',
    DATABASE_URL: 'postgres://user:secret@db.example/books',
  }
  expect(loadConfig(production).smtp).toBeUndefined()
  expect(() => loadConfig(production, 'worker')).toThrow('SMTP')
})
const basic = { BETTER_AUTH_SECRET: 'test-secret-at-least-thirty-two-characters' }
it('validates SMTP credentials, encrypted ports and production delivery', () => {
  expect(() => loadConfig({ ...basic, SMTP_HOST: 'smtp.ethereal.email' })).toThrow(/SMTP/)
  expect(() =>
    loadConfig({
      ...basic,
      SMTP_HOST: 'smtp.ethereal.email',
      SMTP_PORT: '587',
      SMTP_SECURE: 'false',
      SMTP_FROM: 'sender@example.com',
      SMTP_USERNAME: 'user',
    }),
  ).toThrow(/SMTP/)
  const smtp = {
    ...basic,
    SMTP_HOST: 'smtp.ethereal.email',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_FROM: 'sender@example.com',
    SMTP_USERNAME: 'user',
    SMTP_PASSWORD: 'secret',
  }
  expect(loadConfig(smtp).smtp?.port).toBe(587)
  expect(() => loadConfig({ ...smtp, SMTP_SECURE: 'true' })).toThrow(/SMTP/)
  expect(() =>
    loadConfig({
      ...smtp,
      NODE_ENV: 'production',
      DB_PROVIDER: 'postgresql',
      DATABASE_URL: 'postgresql://user:pass@localhost/books',
      FRONTEND_ORIGIN: 'https://books.example',
      BETTER_AUTH_URL: 'https://books.example',
    }),
  ).toThrow(/Ethereal/)
})
it('rejects trailing-dot Ethereal hostnames in production', () => {
  expect(() =>
    loadConfig({
      ...basic,
      NODE_ENV: 'production',
      DB_PROVIDER: 'postgresql',
      DATABASE_URL: 'postgresql://user:pass@localhost/books',
      FRONTEND_ORIGIN: 'https://books.example',
      BETTER_AUTH_URL: 'https://books.example',
      SMTP_HOST: 'smtp.ethereal.email.',
      SMTP_PORT: '587',
      SMTP_SECURE: 'false',
      SMTP_FROM: 'sender@example.com',
      SMTP_USERNAME: 'user',
      SMTP_PASSWORD: 'secret',
    }),
  ).toThrow(/Ethereal/)
})
