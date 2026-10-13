import { expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { createDatabase } from '../src/database/connection.js'
import { seedBooks } from '../src/database/seed.js'
import { createCartRepository } from '../src/modules/cart/cart.repository.js'
import { createCartService } from '../src/modules/cart/cart.service.js'

it('reloads saved account lines and operation receipts after closing and reopening SQLite', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'account-cart-restart-')),
    path = join(folder, 'cart.sqlite')
  let db = createDatabase(path)
  try {
    seedBooks(db)
    db.exec(
      "INSERT INTO user(id,name,email) VALUES('a','A','a@example.com'),('b','B','b@example.com')",
    )
    const input = {
      items: [{ bookId: '1', quantity: 10 }],
      expectedRevision: '0',
      requestKey: randomUUID(),
    }
    const saved = await createCartService(createCartRepository(db)).merge('a', input)
    db.close()
    db = createDatabase(path)
    const reopened = createCartService(createCartRepository(db))
    expect(await reopened.read('a')).toEqual({ ...saved, mergeNotices: [] })
    expect(await reopened.merge('a', input)).toEqual(saved)
    expect(await reopened.read('b')).toEqual({ revision: '0', items: [], mergeNotices: [] })
  } finally {
    db.close()
    rmSync(folder, { recursive: true, force: true })
  }
})
