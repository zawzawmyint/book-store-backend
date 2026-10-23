import type Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { createHash } from 'node:crypto'

const migrationsFolder = fileURLToPath(new URL('../../drizzle/', import.meta.url))

function migrationHashes(migration: ReturnType<typeof readMigrationFiles>[number] | undefined) {
  if (!migration) return new Set<string>()
  const lf = migration.sql.join('--> statement-breakpoint').replaceAll('\r\n', '\n')
  return new Set([
    migration.hash,
    ...[lf, lf.replaceAll('\n', '\r\n')].map((sql) =>
      createHash('sha256').update(sql).digest('hex'),
    ),
  ])
}

// This unreleased draft was applied by local development before the reviewed
// additive migration replaced it. Do not infer migration history from a column alone.
function adoptDraftBookRevision(db: Database.Database): void {
  const history = db
    .prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at')
    .all() as {
    hash: string
    created_at: number
  }[]
  const latest = history.at(-1)
  const migrations = readMigrationFiles({ migrationsFolder })
  const index = migrations.findIndex((migration) => migration.folderMillis === 1792587670357)
  const canonical = migrations[index]
  if (
    latest?.created_at !== 1792586504514 ||
    latest.hash !== 'fb9416a413ec97dcb589fd91a6246952c2950bca5c0bf5b7e0a6a209e136200f'
  ) {
    const hasRevision = (db.pragma('table_info(books)') as { name: string }[]).some(
      (column) => column.name === 'details_revision',
    )
    if (
      hasRevision &&
      !history.some(
        (entry) =>
          entry.created_at === canonical?.folderMillis &&
          migrationHashes(canonical).has(entry.hash),
      )
    )
      throw new Error('Unsupported draft book revision migration history')
    return
  }

  const predecessor = migrations[index - 1]
  // Git can change SQL line endings on checkout; accept only equivalent source
  // text for the predecessor, without rewriting its existing history record.
  const predecessorHashes = migrationHashes(predecessor)
  if (
    !canonical ||
    index < 1 ||
    history.length !== index + 1 ||
    !migrations
      .slice(0, index)
      .every((migration, position) => history[position].created_at === migration.folderMillis) ||
    !predecessorHashes.has(history[index - 1].hash)
  )
    throw new Error('Unsupported draft book revision migration history')

  const column = (
    db.pragma('table_info(books)') as {
      name: string
      type: string
      notnull: number
      dflt_value: string | null
      pk: number
    }[]
  ).find((entry) => entry.name === 'details_revision')
  if (
    column?.type.toLowerCase() !== 'integer' ||
    column.notnull !== 1 ||
    column.pk !== 0 ||
    column.dflt_value?.replace(/[\s()]/g, '') !== '0' ||
    db
      .prepare(
        'SELECT 1 FROM books WHERE details_revision IS NULL OR details_revision NOT BETWEEN 0 AND 2147483647 LIMIT 1',
      )
      .get() ||
    (db.pragma('foreign_key_check') as unknown[]).length
  )
    throw new Error('Unsupported draft book revision schema or data')

  // SQLite cannot add a CHECK to an existing column without rebuilding books.
  // Match its range constraint with triggers, preserving all rows and references.
  for (const action of ['INSERT', 'UPDATE']) {
    db.exec(`CREATE TRIGGER draft_books_details_revision_${action.toLowerCase()}_check
      BEFORE ${action} ON books WHEN NEW.details_revision NOT BETWEEN 0 AND 2147483647
      BEGIN SELECT RAISE(ABORT, 'details_revision must be between 0 and 2147483647'); END`)
  }
  // Keep the recognized draft record as provenance. Drizzle resumes after the
  // canonical record, so it never attempts to add the existing column again.
  db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(
    canonical.hash,
    canonical.folderMillis,
  )
}

// The old user_version=1 schema is equivalent to the first Drizzle migration.
// Verify it before recording that baseline; do not recreate tables containing orders.
function verifyLegacySchema(
  db: Database.Database,
): { table: 'orders' | 'order_items'; column: string }[] {
  const expected = {
    books: ['id', 'title', 'author', 'genre', 'description', 'price_cents', 'stock'],
    orders: ['id', 'customer_name', 'email', 'total_cents', 'created_at'],
    order_items: ['id', 'order_id', 'book_id', 'title', 'quantity', 'unit_price_cents'],
  }
  const checks = {
    books: ['check(price_cents>=0)', 'check(stock>=0)'],
    orders: [],
    order_items: ['check(quantity>0)'],
  }
  const legacyMonetaryChecks: { table: 'orders' | 'order_items'; column: string }[] = []
  for (const table of Object.keys(expected) as (keyof typeof expected)[]) {
    const columns = db.pragma(`table_info(${table})`) as {
      name: string
      type: string
      notnull: number
      pk: number
      dflt_value: string | null
    }[]
    const definition = db
      .prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?')
      .get('table', table) as { sql: string } | undefined
    const normalized =
      definition?.sql
        .toLowerCase()
        .replace(/[\s`"[\]]/g, '')
        .replaceAll(`${table}.`, '') ?? ''
    const integerColumns = [
      'id',
      'price_cents',
      'stock',
      'total_cents',
      'order_id',
      'book_id',
      'quantity',
      'unit_price_cents',
    ]
    if (
      columns.map((column) => column.name).join(',') !== expected[table].join(',') ||
      columns.some(
        (column) =>
          column.type.toLowerCase() !==
            (integerColumns.includes(column.name) ? 'integer' : 'text') ||
          (column.name === 'id' ? column.pk !== 1 : column.notnull !== 1),
      ) ||
      !normalized.includes('autoincrement') ||
      !checks[table].every((check) => normalized.includes(check)) ||
      (table === 'orders' &&
        columns
          .find((column) => column.name === 'created_at')
          ?.dflt_value?.replace(/[\s()]/g, '') !== "datetime'now'")
    ) {
      throw new Error(`Unsupported legacy schema for ${table}`)
    }
    if (table === 'orders' || table === 'order_items') {
      const column = table === 'orders' ? 'total_cents' : 'unit_price_cents'
      if (!normalized.includes(`check(${column}>=0)`)) {
        const invalid = db.prepare(`SELECT 1 FROM ${table} WHERE ${column} < 0 LIMIT 1`).get()
        if (invalid) throw new Error(`Unsupported legacy data in ${table}.${column}`)
        legacyMonetaryChecks.push({ table, column })
      }
    }
  }
  const foreignKeys = db.pragma('foreign_key_list(order_items)') as {
    table: string
    from: string
    to: string
    on_update: string
    on_delete: string
  }[]
  if (
    foreignKeys.length !== 2 ||
    !foreignKeys.some(
      (key) => key.from === 'order_id' && key.table === 'orders' && key.to === 'id',
    ) ||
    !foreignKeys.some(
      (key) => key.from === 'book_id' && key.table === 'books' && key.to === 'id',
    ) ||
    foreignKeys.some((key) => key.on_update !== 'NO ACTION' || key.on_delete !== 'NO ACTION') ||
    (db.pragma('foreign_key_check') as unknown[]).length !== 0
  ) {
    throw new Error('Unsupported legacy foreign keys')
  }
  return legacyMonetaryChecks
}

export function migrateDatabase(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as number
  if (version > 1) throw new Error(`Unsupported database version: ${version}`)
  const columns = db.pragma('table_info(orders)') as { name: string }[]
  if (
    columns.length &&
    !columns.some((column) => column.name === 'status') &&
    db.prepare('SELECT 1 FROM orders LIMIT 1').get()
  ) {
    throw new Error(
      'Order workflow requires a fresh database; reset and reseed development data explicitly',
    )
  }
  if (
    columns.length &&
    !columns.some((column) => column.name === 'delivery_fee_cents') &&
    db.prepare('SELECT 1 FROM orders LIMIT 1').get()
  )
    throw new Error(
      'Delivery requires a fresh database; reset and reseed development data explicitly',
    )
  const config = { migrationsFolder }
  db.transaction(() => {
    const journal = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
      )
      .get()
    if (version === 1 && !journal) {
      const legacyMonetaryChecks = verifyLegacySchema(db)
      const baseline = readMigrationFiles(config)[0]
      if (!baseline) throw new Error('Missing Drizzle baseline migration')
      // Early version-one databases lacked these two checks. SQLite cannot add
      // a table CHECK in place, so preserve rows and enforce the same rule with triggers.
      for (const { table, column } of legacyMonetaryChecks) {
        for (const action of ['INSERT', 'UPDATE']) {
          db.exec(`CREATE TRIGGER legacy_${table}_${column}_${action.toLowerCase()}_check
            BEFORE ${action} ON ${table} WHEN NEW.${column} < 0
            BEGIN SELECT RAISE(ABORT, '${column} must be nonnegative'); END`)
        }
      }
      db.exec(
        'CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
      )
      db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(
        baseline.hash,
        baseline.folderMillis,
      )
    }
    if (journal) adoptDraftBookRevision(db)
  })()
  // Drizzle's SQLite migrator owns the transaction for pending schema changes.
  migrate(drizzle(db), config)
  // Retain the legacy marker as provenance; Drizzle tracks all subsequent changes.
  db.pragma('user_version = 1')
}
