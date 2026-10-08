import type Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { drizzle as sqliteDrizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { drizzle as postgresDrizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import type { AppConfig } from '../config/env.js'
import { createDatabase } from './connection.js'
import * as sqliteSchema from './schema.js'
import * as postgresSchema from './postgresql/schema.js'
import { createPostgresqlPool, assertPostgresqlReady } from './postgresql/connection.js'
export type DatabaseHandle =
  | { provider: 'sqlite'; raw: Database.Database; orm: BetterSQLite3Database<typeof sqliteSchema> }
  | { provider: 'postgresql'; pool: Pool; orm: NodePgDatabase<typeof postgresSchema> }
export function sqliteHandle(
  raw: Database.Database,
): Extract<DatabaseHandle, { provider: 'sqlite' }> {
  return { provider: 'sqlite', raw, orm: sqliteDrizzle(raw, { schema: sqliteSchema }) }
}
export function normalizeDatabaseHandle(input: DatabaseHandle | Database.Database): DatabaseHandle {
  return 'provider' in input ? input : sqliteHandle(input)
}
export async function openDatabase(
  config: AppConfig,
): Promise<{ handle: DatabaseHandle; close(): Promise<void> }> {
  if (config.databaseProvider === 'sqlite') {
    if (config.nodeEnv === 'production') throw new Error('Production requires PostgreSQL')
    if (config.databasePath !== ':memory:')
      mkdirSync(dirname(resolve(config.databasePath)), { recursive: true })
    const raw = createDatabase(config.databasePath)
    let closed = false
    return {
      handle: sqliteHandle(raw),
      async close() {
        if (!closed) {
          closed = true
          raw.close()
        }
      },
    }
  }
  const pool = createPostgresqlPool(config)
  try {
    await assertPostgresqlReady(pool)
    let closing: Promise<void> | undefined
    return {
      handle: {
        provider: 'postgresql',
        pool,
        orm: postgresDrizzle(pool, { schema: postgresSchema }),
      },
      close() {
        return (closing ??= pool.end())
      },
    }
  } catch (error) {
    await pool.end()
    throw error
  }
}
