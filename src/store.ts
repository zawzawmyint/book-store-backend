import { GraphQLError } from 'graphql'
import type Database from 'better-sqlite3'
import type { BookRow } from './db.js'

type OrderInput = {
  customerName: string
  email: string
  items: Array<{ bookId: string; quantity: number }>
}

const invalid = (message: string) =>
  new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } })

export function createStore(db: Database.Database) {
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
        throw invalid('Invalid search or page size')
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
    placeOrder(input: OrderInput) {
      const name = input.customerName.trim()
      const email = input.email.trim().toLowerCase()
      if (!name || name.length > 120) throw invalid('Enter a name of up to 120 characters')
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw invalid('Enter a valid email address')
      if (input.items.length < 1 || input.items.length > 20)
        throw invalid('Order must contain 1 to 20 books')
      if (new Set(input.items.map((item) => item.bookId)).size !== input.items.length)
        throw invalid('Each book can appear only once')
      for (const item of input.items) {
        if (
          !/^\d+$/.test(item.bookId) ||
          !Number.isInteger(item.quantity) ||
          item.quantity < 1 ||
          item.quantity > 10
        ) {
          throw invalid('Each quantity must be between 1 and 10')
        }
      }

      return db.transaction(() => {
        const lines = input.items.map((item) => {
          const book = db.prepare('SELECT * FROM books WHERE id = ?').get(Number(item.bookId)) as
            BookRow | undefined
          if (!book) throw invalid(`Book ${item.bookId} was not found`)
          if (book.stock < item.quantity)
            throw invalid(`${book.title} has only ${book.stock} in stock`)
          return { book, quantity: item.quantity }
        })
        const totalCents = lines.reduce(
          (total, line) => total + line.book.price_cents * line.quantity,
          0,
        )
        const result = db
          .prepare('INSERT INTO orders (customer_name, email, total_cents) VALUES (?, ?, ?)')
          .run(name, email, totalCents)
        const orderId = Number(result.lastInsertRowid)
        const insertLine = db.prepare(
          'INSERT INTO order_items (order_id, book_id, title, quantity, unit_price_cents) VALUES (?, ?, ?, ?, ?)',
        )
        const reduceStock = db.prepare(
          'UPDATE books SET stock = stock - ? WHERE id = ? AND stock >= ?',
        )
        for (const line of lines) {
          if (reduceStock.run(line.quantity, line.book.id, line.quantity).changes !== 1)
            throw invalid(`${line.book.title} is out of stock`)
          insertLine.run(
            orderId,
            line.book.id,
            line.book.title,
            line.quantity,
            line.book.price_cents,
          )
        }
        return {
          id: String(orderId),
          totalCents,
          items: lines.map(({ book, quantity }) => ({
            title: book.title,
            quantity,
            unitPriceCents: book.price_cents,
          })),
        }
      })()
    },
  }
}
