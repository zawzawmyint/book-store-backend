import type Database from 'better-sqlite3'
import { ValidationError } from './errors.js'

export type BookRow = {
  id: number
  title: string
  author: string
  genre: string
  description: string
  price_cents: number
  stock: number
}

export function createCatalogRepository(db: Database.Database) {
  return {
    listBooks(search = '', limit = 12, offset = 0) {
      const term = search.trim()
      if (
        term.length > 100 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 24 ||
        !Number.isInteger(offset) ||
        offset < 0
      ) {
        throw new ValidationError('Invalid search or page size')
      }
      const pattern = `%${term.replace(/[\\%_]/g, '\\$&')}%`
      const where =
        "WHERE title LIKE ? ESCAPE '\\' OR author LIKE ? ESCAPE '\\' OR genre LIKE ? ESCAPE '\\'"
      const total = (
        db
          .prepare(`SELECT COUNT(*) AS count FROM books ${where}`)
          .get(pattern, pattern, pattern) as { count: number }
      ).count
      const items = db
        .prepare(`SELECT * FROM books ${where} ORDER BY id LIMIT ? OFFSET ?`)
        .all(pattern, pattern, pattern, limit, offset) as BookRow[]
      return { total, items }
    },
    getBook(id: string) {
      if (!/^\d+$/.test(id)) return null
      return (
        (db.prepare('SELECT * FROM books WHERE id = ?').get(Number(id)) as BookRow | undefined) ??
        null
      )
    },
  }
}
