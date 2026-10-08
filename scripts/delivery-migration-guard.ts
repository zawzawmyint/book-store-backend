import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { deepEqual, rejects, strictEqual } from 'node:assert/strict'
import { loadConfig } from '../src/config/env.js'
import { migratePostgresql } from '../src/database/postgresql/connection.js'

// Only called with the database just created by the UUID-owned disposable runner.
// Apply the actual historical migration to verify delivery refuses populated data.
export async function verifyPostgresqlDeliveryGuard(url: string, directory: string) {
  const migrationsFolder = join(directory, 'pre-delivery-migrations')
  await mkdir(join(migrationsFolder, 'meta'), { recursive: true })
  const source = resolve('drizzle/postgresql')
  const journal = JSON.parse(await readFile(join(source, 'meta/_journal.json'), 'utf8'))
  const baseline = journal.entries[0]
  await copyFile(join(source, `${baseline.tag}.sql`), join(migrationsFolder, `${baseline.tag}.sql`))
  await writeFile(
    join(migrationsFolder, 'meta/_journal.json'),
    JSON.stringify({ ...journal, entries: [baseline] }),
  )
  const pool = new Pool({ connectionString: url, max: 2 })
  try {
    await migrate(drizzle(pool), { migrationsFolder })
    await pool.query(
      'INSERT INTO orders (customer_name, email, total_cents, status) VALUES ($1,$2,$3,$4)',
      ['Historical Reader', 'old@example.com', 1699, 'COMPLETED'],
    )
    const config = loadConfig({
      NODE_ENV: 'test',
      DB_PROVIDER: 'postgresql',
      DATABASE_URL: url,
      PG_TLS_MODE: 'disable',
      BETTER_AUTH_SECRET: 'postgresql-test-secret-at-least-thirty-two-characters',
    })
    await rejects(migratePostgresql(config), /fresh database/)
    const before = await pool.query('SELECT status,total_cents,payment_status FROM orders')
    deepEqual(before.rows, [
      { status: 'COMPLETED', total_cents: 1699, payment_status: 'LEGACY_UNPAID' },
    ])
    strictEqual(
      (await pool.query("SELECT to_regclass('public.order_deliveries') AS relation")).rows[0]
        .relation,
      null,
    )
    strictEqual(
      (await pool.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations')).rows[0]
        .count,
      1,
    )
    strictEqual(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM information_schema.columns WHERE table_name='orders' AND column_name IN ('subtotal_cents','delivery_fee_cents')",
        )
      ).rows[0].count,
      0,
    )
    console.log('PostgreSQL populated-order delivery migration guard verified without writes')
  } finally {
    await pool.end()
  }
}
