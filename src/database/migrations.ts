import type Database from 'better-sqlite3'

const migrations = [
  `
    CREATE TABLE books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      genre TEXT NOT NULL,
      description TEXT NOT NULL,
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
      stock INTEGER NOT NULL CHECK (stock >= 0)
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      email TEXT NOT NULL,
      total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      book_id INTEGER NOT NULL REFERENCES books(id),
      title TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0)
    );
  `,
]

export function migrateDatabase(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as number
  if (version > migrations.length) throw new Error(`Unsupported database version: ${version}`)
  for (let index = version; index < migrations.length; index++) {
    db.transaction(() => {
      db.exec(migrations[index])
      db.pragma(`user_version = ${index + 1}`)
    })()
  }
}
