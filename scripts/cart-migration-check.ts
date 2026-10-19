import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { deepEqual, strictEqual } from 'node:assert/strict'

// The caller creates and owns this disposable database. Never use application data.
export async function verifyPostgreSQLCartMigration(url: string, directory: string) {
  const folder = join(directory, 'pre-cart-migrations'),
    source = resolve('drizzle/postgresql')
  await mkdir(join(folder, 'meta'), { recursive: true })
  const journal = JSON.parse(await readFile(join(source, 'meta/_journal.json'), 'utf8'))
  const entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 2)
  for (const entry of entries)
    await copyFile(join(source, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }))
  const pool = new Pool({ connectionString: url, max: 2 })
  try {
    await migrate(drizzle(pool), { migrationsFolder: folder })
    await pool.query(`INSERT INTO "user"(id,name,email) VALUES('saved','Saved','saved@example.com');
      INSERT INTO books(id,title,author,genre,description,price_cents,stock) OVERRIDING SYSTEM VALUE VALUES(42,'Saved','Author','Genre','Book',100,5);
      INSERT INTO orders(id,user_id,customer_name,email,subtotal_cents,delivery_fee_cents,total_cents) OVERRIDING SYSTEM VALUE VALUES(9,'saved','Saved','saved@example.com',100,500,600);
      INSERT INTO order_items(order_id,book_id,title,quantity,unit_price_cents) VALUES(9,42,'Snapshot',1,100);
      INSERT INTO checkout_requests(user_id,request_key,lines_json,delivery_json,order_id) VALUES('saved','key','[]','{}',9);`)
    const tables = ['user', 'books', 'orders', 'order_items', 'checkout_requests']
    const before = await Promise.all(tables.map((table) => pool.query(`SELECT * FROM "${table}"`)))
    before[1].rows = before[1].rows.map((row) => ({
      ...row,
      cover_key: null,
      cover_width: null,
      cover_height: null,
      cover_revision: 0,
    }))
    await migrate(drizzle(pool), { migrationsFolder: source })
    await migrate(drizzle(pool), { migrationsFolder: source })
    for (let i = 0; i < tables.length; i++)
      deepEqual((await pool.query(`SELECT * FROM "${tables[i]}"`)).rows, before[i].rows)
    for (const table of [
      'account_carts',
      'account_cart_items',
      'cart_operations',
      'checkout_cart_snapshots',
    ])
      strictEqual((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 0)
    console.log(
      'PostgreSQL additive cart migration preserved populated accounts/orders and existing checkout receipts',
    )
  } finally {
    await pool.end()
  }
}
