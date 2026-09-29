import type Database from 'better-sqlite3'

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
    listBooks(search: string, limit: number, offset: number) {
      const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`
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
