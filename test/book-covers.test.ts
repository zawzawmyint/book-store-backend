import { afterEach, expect, it } from 'vitest'
import { createDatabase } from '../src/database/connection.js'
import { seedBooks } from '../src/database/seed.js'
import { normalizeStore } from '../src/database/persistence.js'

const databases: ReturnType<typeof createDatabase>[] = []
afterEach(() => databases.splice(0).forEach((db) => db.close()))
it('migrates existing catalog storage to optional cover metadata and revision zero', async () => {
  const db = createDatabase(':memory:')
  databases.push(db)
  seedBooks(db)
  const store = normalizeStore(db)
  expect(await store.book(1)).toMatchObject({
    coverKey: null,
    coverWidth: null,
    coverHeight: null,
    coverRevision: 0,
  })
  expect((await store.catalog('', 50, 0)).items.length).toBeGreaterThan(0)
})
