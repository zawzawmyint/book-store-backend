import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config/env.js'
import { openDatabase } from '../src/database/runtime.js'
import { postgresqlPoolConfig } from '../src/database/postgresql/connection.js'
const secret = 'runtime-test-secret-longer-than-thirty-two-characters'
describe('provider runtime', () => {
  it('opens SQLite without a PostgreSQL URL and closes idempotently', async () => {
    const runtime = await openDatabase(
      loadConfig({ NODE_ENV: 'test', DATABASE_PATH: ':memory:', BETTER_AUTH_SECRET: secret }),
    )
    expect(runtime.handle.provider).toBe('sqlite')
    await runtime.close()
    await runtime.close()
  })
  it('bounds PostgreSQL connection and statement waits and verifies production TLS', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      FRONTEND_ORIGIN: 'https://store.example.com',
      DATABASE_URL: 'postgresql://user:secret@localhost/store',
      BETTER_AUTH_SECRET: secret,
    })
    expect(postgresqlPoolConfig(config)).toMatchObject({
      max: 10,
      connectionTimeoutMillis: 10000,
      statement_timeout: 30000,
      ssl: { rejectUnauthorized: true },
    })
  })
  it('fails unavailable PostgreSQL without a SQLite fallback', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      DB_PROVIDER: 'postgresql',
      DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/book_store_test_unavailable',
      BETTER_AUTH_SECRET: secret,
    })
    await expect(openDatabase(config)).rejects.toThrow(/PostgreSQL schema/)
  })
})
