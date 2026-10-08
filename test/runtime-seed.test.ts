import { expect, it } from 'vitest'
import { createDatabase } from '../src/database/connection.js'
import { seedRuntimeBooks } from '../src/database/runtime-seed.js'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '../src/database/schema.js'

it('seeds through the selected runtime without duplicating catalog rows', async () => {
  const raw = createDatabase(':memory:')
  try {
    const handle = { provider: 'sqlite' as const, raw, orm: drizzle(raw, { schema }) }
    await seedRuntimeBooks(handle)
    await seedRuntimeBooks(handle)
    expect(raw.prepare('SELECT count(*) AS count FROM books').get()).toEqual({ count: 12 })
  } finally {
    raw.close()
  }
})
