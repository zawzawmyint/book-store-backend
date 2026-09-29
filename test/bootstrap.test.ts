import { describe, expect, it } from 'vitest'
import { createDatabase } from '../src/database/connection.js'
import { seedBooks } from '../src/database/seed.js'
import { loadConfig } from '../src/config/env.js'

describe('bootstrap', () => {
  it('migrates an empty database and seeds demo books only when requested', () => {
    const db = createDatabase(':memory:')
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(1)
      expect(db.prepare('SELECT COUNT(*) AS count FROM books').get()).toEqual({ count: 0 })
      seedBooks(db)
      seedBooks(db)
      expect(db.prepare('SELECT COUNT(*) AS count FROM books').get()).toEqual({ count: 12 })
    } finally {
      db.close()
    }
  })

  it('validates startup configuration', () => {
    expect(loadConfig({})).toEqual({
      port: 4000,
      databasePath: './data/book-store.sqlite',
      frontendOrigin: 'http://localhost:5173',
      nodeEnv: 'development',
    })
    expect(() => loadConfig({ PORT: '0' })).toThrow(/PORT/)
    expect(() => loadConfig({ FRONTEND_ORIGIN: 'not-a-url' })).toThrow(/FRONTEND_ORIGIN/)
  })
})
