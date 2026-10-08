import { describe, expect, it } from 'vitest'
import { createDatabase } from '../src/database/connection.js'
import { seedBooks } from '../src/database/seed.js'
import { loadConfig } from '../src/config/env.js'

describe('bootstrap', () => {
  it('migrates an empty database and seeds demo books only when requested', () => {
    const db = createDatabase(':memory:')
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(1)
      expect(db.prepare('SELECT COUNT(*) AS count FROM books').get()).toEqual({ count: 0 })
      seedBooks(db)
      seedBooks(db)
      expect(db.prepare('SELECT COUNT(*) AS count FROM books').get()).toEqual({ count: 12 })
    } finally {
      db.close()
    }
  })

  it('validates startup configuration', () => {
    const authSecret = 'test-secret-that-is-at-least-thirty-two-characters-long'
    expect(loadConfig({ BETTER_AUTH_SECRET: authSecret })).toEqual({
      port: 4000,
      databasePath: './data/book-store.sqlite',
      databaseProvider: 'sqlite',
      databaseUrl: undefined,
      pgPoolMax: 10,
      pgTlsMode: 'disable',
      pgCaFile: undefined,
      frontendOrigin: 'http://localhost:5173',
      authBaseURL: 'http://localhost:5173',
      authSecret,
      trustedProxyIp: undefined,
      nodeEnv: 'development',
      deliveryEnabled: false,
      deliveryCountryCodes: [],
      deliveryFeeCents: undefined,
      stripeCheckoutEnabled: false,
      stripeSecretKey: undefined,
      stripeWebhookSecret: undefined,
    })
    expect(() => loadConfig({})).toThrow(/BETTER_AUTH_SECRET/)
    expect(() => loadConfig({ PORT: '0' })).toThrow(/PORT/)
    expect(() => loadConfig({ FRONTEND_ORIGIN: 'not-a-url' })).toThrow(/FRONTEND_ORIGIN/)
    expect(() =>
      loadConfig({ BETTER_AUTH_SECRET: authSecret, BETTER_AUTH_URL: 'invalid' }),
    ).toThrow(/BETTER_AUTH_URL/)
    expect(() =>
      loadConfig({ BETTER_AUTH_SECRET: authSecret, AUTH_TRUSTED_PROXY_IP: 'not-an-ip' }),
    ).toThrow(/AUTH_TRUSTED_PROXY_IP/)
  })
})
