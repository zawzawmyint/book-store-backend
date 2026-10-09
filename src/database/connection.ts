import Database from 'better-sqlite3'
import { migrateDatabase } from './migrations.js'

export function createDatabase(path: string): Database.Database {
  const db = new Database(path)
  try {
    db.function('unicode_lower', { deterministic: true }, (value: unknown) =>
      typeof value === 'string' ? value.toLowerCase() : null,
    )
    db.pragma('foreign_keys = ON')
    db.pragma('journal_mode = WAL')
    migrateDatabase(db)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}
