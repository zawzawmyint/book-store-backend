import { expect, it } from 'vitest'
import { loadAuthRateLimitConfig } from '../src/modules/auth-email/auth-rate-limit.config.js'

it('defaults local APIs to memory without Redis and requires shared production limits', () => {
  expect(loadAuthRateLimitConfig({})).toEqual({ store: 'memory' })
  expect(() =>
    loadAuthRateLimitConfig({ NODE_ENV: 'production', AUTH_RATE_LIMIT_STORE: 'memory' }),
  ).toThrow(/require Redis/)
  expect(() => loadAuthRateLimitConfig({ AUTH_RATE_LIMIT_STORE: 'invalid' })).toThrow(
    /AUTH_RATE_LIMIT_STORE/,
  )
  expect(() => loadAuthRateLimitConfig({ NODE_ENV: 'production' })).toThrow(
    /AUTH_RATE_LIMIT_PREFIX/,
  )
})
it('validates explicit namespaces and authenticated production TLS without revealing URLs', () => {
  const base = { NODE_ENV: 'production', AUTH_RATE_LIMIT_PREFIX: 'store-production' }
  for (const redisUrl of [
    'redis://:secret@example.com',
    'rediss://example.com',
    'rediss://:secret@example.com?rejectUnauthorized=false',
    'rediss://:secret@example.com#fragment',
    'invalid',
  ]) {
    expect(() => loadAuthRateLimitConfig({ ...base, REDIS_URL: redisUrl })).toThrow(/REDIS_URL/)
    try {
      loadAuthRateLimitConfig({ ...base, REDIS_URL: redisUrl })
    } catch (error) {
      expect(String(error)).not.toContain('secret')
    }
  }
  expect(
    loadAuthRateLimitConfig({ ...base, REDIS_URL: 'rediss://:secret@example.com:6380/1' }),
  ).toEqual({
    store: 'redis',
    prefix: 'store-production',
    redisUrl: 'rediss://:secret@example.com:6380/1',
  })
  for (const prefix of ['', 'with space', 'other:namespace', 'x'.repeat(101)])
    expect(() =>
      loadAuthRateLimitConfig({ AUTH_RATE_LIMIT_STORE: 'redis', AUTH_RATE_LIMIT_PREFIX: prefix }),
    ).toThrow(/PREFIX/)
})
