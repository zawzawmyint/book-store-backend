import Database from 'better-sqlite3'

export function createDatabase(path: string): Database.Database {
  const db = new Database(path)
  try {
    db.pragma('foreign_keys = ON')
    db.pragma('journal_mode = WAL')
    const version = db.pragma('user_version', { simple: true }) as number
    if (version > 1) throw new Error(`Unsupported database version: ${version}`)
    if (version === 0) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS books (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          author TEXT NOT NULL,
          genre TEXT NOT NULL,
          description TEXT NOT NULL,
          price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
          stock INTEGER NOT NULL CHECK (stock >= 0)
        );
        CREATE TABLE IF NOT EXISTS orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_name TEXT NOT NULL,
          email TEXT NOT NULL,
          total_cents INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS order_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_id INTEGER NOT NULL REFERENCES orders(id),
          book_id INTEGER NOT NULL REFERENCES books(id),
          title TEXT NOT NULL,
          quantity INTEGER NOT NULL CHECK (quantity > 0),
          unit_price_cents INTEGER NOT NULL
        );
      `)
      db.pragma('user_version = 1')
    }
    return db
  } catch (error) {
    db.close()
    throw error
  }
}
