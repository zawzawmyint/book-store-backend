import Database from 'better-sqlite3'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDatabase } from '../src/database/connection.js'
import { migrateDatabase } from '../src/database/migrations.js'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

it('adds empty activity history to a populated Staff schema without changing existing business data', () => {
  const directory = mkdtempSync(join(tmpdir(), 'activity-migration-'))
  const db = new Database(':memory:')
  try {
    mkdirSync(join(directory, 'meta'))
    const journal = JSON.parse(
      readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'),
    ) as { entries: Array<{ tag: string }> }
    journal.entries = journal.entries.slice(0, 5)
    writeFileSync(join(directory, 'meta', '_journal.json'), JSON.stringify(journal))
    for (const entry of journal.entries)
      copyFileSync(
        new URL(`../drizzle/${entry.tag}.sql`, import.meta.url),
        join(directory, `${entry.tag}.sql`),
      )
    db.pragma('foreign_keys = ON')
    migrate(drizzle(db), { migrationsFolder: directory })
    db.exec(`
      INSERT INTO user (id,name,email) VALUES ('staff','Staff','staff@example.com');
      INSERT INTO user_roles VALUES ('staff','STAFF');
      INSERT INTO account (id,account_id,provider_id,user_id,password,updated_at) VALUES ('credential','staff','credential','staff','saved-hash',1);
      INSERT INTO session (id,expires_at,token,updated_at,user_id) VALUES ('saved',2000000000000,'saved-token',1,'staff');
      INSERT INTO books (id,title,author,genre,description,price_cents,stock,archived) VALUES (42,'Saved','Author','Genre','Description',100,5,1);
      INSERT INTO orders (id,user_id,customer_name,email,total_cents) VALUES (9,'staff','Staff','staff@example.com',100);
      INSERT INTO order_items (order_id,book_id,title,quantity,unit_price_cents) VALUES (9,42,'Saved',1,100);
    `)
    const tables = ['user', 'user_roles', 'account', 'session', 'books', 'orders', 'order_items']
    const before = tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all())
    migrateDatabase(db)
    migrateDatabase(db)
    expect(tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all())).toEqual(before)
    expect(db.prepare('SELECT * FROM activity_events').all()).toEqual([])
    expect(db.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({ n: 6 })
    expect(db.pragma('foreign_key_check')).toEqual([])
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

it('migrates populated admin memberships to roles without losing admins or identity data', () => {
  const directory = mkdtempSync(join(tmpdir(), 'staff-role-migration-'))
  const db = new Database(':memory:')
  try {
    mkdirSync(join(directory, 'meta'))
    const journal = JSON.parse(
      readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'),
    )
    journal.entries = journal.entries.slice(0, 4)
    writeFileSync(join(directory, 'meta', '_journal.json'), JSON.stringify(journal))
    for (const entry of journal.entries)
      copyFileSync(
        new URL(`../drizzle/${entry.tag}.sql`, import.meta.url),
        join(directory, `${entry.tag}.sql`),
      )
    db.pragma('foreign_keys = ON')
    migrate(drizzle(db), { migrationsFolder: directory })
    db.exec(
      "INSERT INTO user (id, name, email) VALUES ('owner', 'Owner', 'owner@example.com'), ('buyer', 'Buyer', 'buyer@example.com'); INSERT INTO admin_memberships (user_id) VALUES ('owner');",
    )
    const before = db.prepare('SELECT * FROM user').all()
    migrateDatabase(db)
    expect(db.prepare('SELECT * FROM user').all()).toEqual(before)
    expect(db.prepare('SELECT * FROM user_roles').all()).toEqual([
      { user_id: 'owner', role: 'ADMIN' },
    ])
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'admin_memberships'").get(),
    ).toBeUndefined()
    expect(() => db.exec("INSERT INTO user_roles VALUES ('buyer', 'INVALID')")).toThrow(/CHECK/)
    expect(() => db.exec("INSERT INTO user_roles VALUES ('unknown', 'STAFF')")).toThrow(
      /FOREIGN KEY/,
    )
    expect(() => db.exec("INSERT INTO user_roles VALUES ('owner', 'STAFF')")).toThrow(/UNIQUE/)
    db.exec("DELETE FROM user WHERE id = 'owner'")
    expect(db.prepare('SELECT * FROM user_roles').all()).toEqual([])
    migrateDatabase(db)
    expect(db.pragma('foreign_key_check')).toEqual([])
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

it('upgrades the current authenticated schema preserving accounts, sessions, and owned orders', () => {
  const directory = mkdtempSync(join(tmpdir(), 'admin-current-migration-'))
  const db = new Database(':memory:')
  try {
    mkdirSync(join(directory, 'meta'))
    const journal = JSON.parse(
      readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'),
    ) as { entries: Array<{ tag: string }> }
    journal.entries = journal.entries.slice(0, 2)
    writeFileSync(join(directory, 'meta', '_journal.json'), JSON.stringify(journal))
    for (const entry of journal.entries)
      copyFileSync(
        new URL(`../drizzle/${entry.tag}.sql`, import.meta.url),
        join(directory, `${entry.tag}.sql`),
      )
    db.pragma('foreign_keys = ON')
    migrate(drizzle(db), { migrationsFolder: directory })
    db.exec(`
      INSERT INTO user (id, name, email) VALUES ('existing-user', 'Existing', 'existing@example.com');
      INSERT INTO account (id, account_id, provider_id, user_id, password, updated_at) VALUES ('existing-account', 'existing-user', 'credential', 'existing-user', 'saved-password-hash', 1);
      INSERT INTO session (id, expires_at, token, updated_at, user_id) VALUES ('existing-session', 2000000000000, 'saved-session-token', 1, 'existing-user');
      INSERT INTO books (id, title, author, genre, description, price_cents, stock) VALUES (42, 'Existing book', 'Author', 'Genre', 'Description', 1234, 7);
      INSERT INTO orders (id, user_id, customer_name, email, total_cents) VALUES (9, 'existing-user', 'Existing', 'existing@example.com', 2468);
      INSERT INTO order_items (id, order_id, book_id, title, quantity, unit_price_cents) VALUES (11, 9, 42, 'Existing book', 2, 1234);
    `)
    const before = ['user', 'account', 'session', 'orders', 'order_items'].map((table) =>
      db.prepare(`SELECT * FROM ${table}`).all(),
    )
    migrateDatabase(db)
    expect(
      ['user', 'account', 'session', 'orders', 'order_items'].map((table) =>
        db.prepare(`SELECT * FROM ${table}`).all(),
      ),
    ).toEqual(before)
    expect(db.prepare('SELECT id, stock, archived FROM books').get()).toEqual({
      id: 42,
      stock: 7,
      archived: 0,
    })
    expect(
      db.prepare("SELECT count(*) AS count FROM user_roles WHERE role = 'ADMIN'").get(),
    ).toEqual({
      count: 0,
    })
    expect(db.pragma('foreign_key_check')).toEqual([])
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Drizzle migration adoption', () => {
  it('rejects an incompatible legacy schema without recording a baseline or altering data', () => {
    const db = new Database(':memory:')
    try {
      db.exec(
        "CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT); INSERT INTO books VALUES (1, 'Preserve me')",
      )
      db.pragma('user_version = 1')
      expect(() => migrateDatabase(db)).toThrow('Unsupported legacy schema for books')
      expect(db.prepare('SELECT * FROM books').all()).toEqual([{ id: 1, title: 'Preserve me' }])
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE name = '__drizzle_migrations'").get(),
      ).toBeUndefined()
    } finally {
      db.close()
    }
  })
  it('tracks the baseline on a fresh database', () => {
    const db = createDatabase(':memory:')
    try {
      expect(db.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get()).toEqual({
        count: 6,
      })
      expect(() =>
        db
          .prepare(
            'INSERT INTO books (title, author, genre, description, price_cents, stock) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run('A', 'B', 'C', 'D', -1, 1),
      ).toThrow(/CHECK/)
    } finally {
      db.close()
    }
  })

  it('adopts a version-one database and preserves catalog, orders, lines and stock across reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'book-store-migration-'))
    const path = join(directory, 'legacy.sqlite')
    try {
      const legacy = new Database(path)
      try {
        legacy.exec(`
          CREATE TABLE books (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, author TEXT NOT NULL, genre TEXT NOT NULL, description TEXT NOT NULL, price_cents INTEGER NOT NULL CHECK (price_cents >= 0), stock INTEGER NOT NULL CHECK (stock >= 0));
          CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_name TEXT NOT NULL, email TEXT NOT NULL, total_cents INTEGER NOT NULL CHECK (total_cents >= 0), created_at TEXT NOT NULL DEFAULT (datetime('now')));
          CREATE TABLE order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id), book_id INTEGER NOT NULL REFERENCES books(id), title TEXT NOT NULL, quantity INTEGER NOT NULL CHECK (quantity > 0), unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0));
        `)
        legacy.pragma('user_version = 1')
        legacy.exec(
          "INSERT INTO books VALUES (42, 'Legacy', 'Author', 'Genre', 'Description', 1234, 7); INSERT INTO orders (id, customer_name, email, total_cents) VALUES (9, 'Reader', 'reader@example.com', 2468); INSERT INTO order_items VALUES (11, 9, 42, 'Legacy', 2, 1234)",
        )
        legacy.prepare('UPDATE books SET description = ? WHERE id = 42').run('x'.repeat(6000))
      } finally {
        legacy.close()
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        const db = createDatabase(path)
        try {
          expect(db.prepare('SELECT id, price_cents, stock FROM books').all()).toEqual([
            { id: 42, price_cents: 1234, stock: 7 },
          ])
          expect(db.prepare('SELECT id, user_id, total_cents FROM orders').all()).toEqual([
            { id: 9, user_id: null, total_cents: 2468 },
          ])
          expect(db.prepare('SELECT order_id, book_id, quantity FROM order_items').all()).toEqual([
            { order_id: 9, book_id: 42, quantity: 2 },
          ])
          expect(db.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get()).toEqual({
            count: 6,
          })
          expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
          expect(
            db
              .prepare('SELECT archived, length(description) AS size FROM books WHERE id = 42')
              .get(),
          ).toEqual({ archived: 0, size: 6000 })
          expect(
            db.prepare("SELECT count(*) AS count FROM user_roles WHERE role = 'ADMIN'").get(),
          ).toEqual({
            count: 0,
          })
          expect(() => db.prepare('UPDATE books SET archived = 2 WHERE id = 42').run()).toThrow(
            /CHECK/,
          )
        } finally {
          db.close()
        }
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('adopts the original schema without monetary CHECK clauses and protects existing data', () => {
    const db = new Database(':memory:')
    try {
      db.exec(`
        CREATE TABLE books (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, author TEXT NOT NULL, genre TEXT NOT NULL, description TEXT NOT NULL, price_cents INTEGER NOT NULL CHECK (price_cents >= 0), stock INTEGER NOT NULL CHECK (stock >= 0));
        CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_name TEXT NOT NULL, email TEXT NOT NULL, total_cents INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
        CREATE TABLE order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id), book_id INTEGER NOT NULL REFERENCES books(id), title TEXT NOT NULL, quantity INTEGER NOT NULL CHECK (quantity > 0), unit_price_cents INTEGER NOT NULL);
        INSERT INTO books VALUES (42, 'Legacy', 'Author', 'Genre', 'Description', 1234, 7);
        INSERT INTO orders (id, customer_name, email, total_cents) VALUES (9, 'Reader', 'reader@example.com', 2468);
        INSERT INTO order_items VALUES (11, 9, 42, 'Legacy', 2, 1234);
      `)
      db.pragma('user_version = 1')
      migrateDatabase(db)
      expect(db.prepare('SELECT id, user_id, total_cents FROM orders').all()).toEqual([
        { id: 9, user_id: null, total_cents: 2468 },
      ])
      expect(() => db.prepare('UPDATE orders SET total_cents = -1 WHERE id = 9').run()).toThrow()
      expect(() =>
        db.prepare('UPDATE order_items SET unit_price_cents = -1 WHERE id = 11').run(),
      ).toThrow()
      expect(db.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get()).toEqual({
        count: 6,
      })
    } finally {
      db.close()
    }
  })

  it('rejects unsupported legacy versions', () => {
    const directory = mkdtempSync(join(tmpdir(), 'book-store-version-'))
    const path = join(directory, 'future.sqlite')
    try {
      const db = new Database(path)
      db.pragma('user_version = 2')
      db.close()
      expect(() => createDatabase(path)).toThrow('Unsupported database version: 2')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
