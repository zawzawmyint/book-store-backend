import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Pool, type PoolConfig } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import type { AppConfig } from '../../config/env.js'
import * as schema from './schema.js'
const migrationsFolder = fileURLToPath(new URL('../../../drizzle/postgresql/', import.meta.url))
export function postgresqlPoolConfig(config: AppConfig): PoolConfig {
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required')
  return {
    connectionString: config.databaseUrl,
    max: config.pgPoolMax,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 30_000,
    ssl:
      config.pgTlsMode === 'verify-full'
        ? {
            rejectUnauthorized: true,
            ...(config.pgCaFile ? { ca: readFileSync(config.pgCaFile, 'utf8') } : {}),
          }
        : false,
  }
}
export function createPostgresqlPool(config: AppConfig) {
  const pool = new Pool(postgresqlPoolConfig(config))
  // Idle clients are discarded by pg after errors. Never expose connection secrets.
  pool.on('error', () => {
    console.error('PostgreSQL idle connection unavailable')
  })
  return pool
}
export async function assertPostgresqlReady(pool: Pool) {
  const migrations = readMigrationFiles({ migrationsFolder })
  const expected = migrations.at(-1)?.hash
  try {
    const result = await pool.query<{ hash: string }>(
      'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1',
    )
    if (!expected || result.rows[0]?.hash !== expected) throw new Error()
    // Check executable model, not merely a journal left behind after dropped tables.
    // One zero-row query resolves all expected relations without exposing data.
    await pool.query(`SELECT 1 FROM books, orders, order_deliveries, order_items, order_status_events,
      checkout_requests, payment_operations, payment_events, activity_events,
      user_roles, "user", session, account, verification LIMIT 0`)
  } catch {
    throw new Error('PostgreSQL schema is unavailable or outdated; run db:migrate before startup')
  }
}
export async function migratePostgresql(config: AppConfig) {
  const pool = createPostgresqlPool(config)
  try {
    await migrate(drizzle(pool, { schema }), { migrationsFolder })
  } finally {
    await pool.end()
  }
}
