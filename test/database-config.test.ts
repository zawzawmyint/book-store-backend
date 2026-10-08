import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config/env.js'
const base = { BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-thirty-two-characters-long' }
const prod = {
  ...base,
  NODE_ENV: 'production',
  FRONTEND_ORIGIN: 'https://store.example.com',
  BETTER_AUTH_URL: 'https://store.example.com',
  DATABASE_URL: 'postgresql://user:password@localhost/store',
}
describe('database configuration', () => {
  it('defaults development to SQLite and production to verified PostgreSQL', () => {
    expect(loadConfig(base).databaseProvider).toBe('sqlite')
    expect(loadConfig(prod)).toMatchObject({
      databaseProvider: 'postgresql',
      pgTlsMode: 'verify-full',
      pgPoolMax: 10,
    })
  })
  it('rejects unsafe or invalid configuration before connecting', () => {
    expect(() => loadConfig({ ...prod, DB_PROVIDER: 'sqlite' })).toThrow(/Production.*PostgreSQL/)
    expect(() => loadConfig({ ...base, DB_PROVIDER: 'mysql' })).toThrow(/DB_PROVIDER/)
    expect(() => loadConfig({ ...base, DB_PROVIDER: 'postgresql' })).toThrow(/DATABASE_URL/)
    expect(() => loadConfig({ ...prod, PG_TLS_MODE: 'disable' })).toThrow(/Production.*TLS/)
    expect(() =>
      loadConfig({ ...prod, DATABASE_URL: prod.DATABASE_URL + '?sslmode=require' }),
    ).toThrow(/TLS/)
    expect(() =>
      loadConfig({ ...base, DB_PROVIDER: 'postgresql', DATABASE_URL: 'postgres://localhost/' }),
    ).toThrow(/DATABASE_URL/)
    expect(() => loadConfig({ ...base, PG_POOL_MAX: '101' })).toThrow(/PG_POOL_MAX/)
  })
})
