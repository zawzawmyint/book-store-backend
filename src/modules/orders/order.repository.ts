import type Database from 'better-sqlite3'
import type { BookRow } from '../books/book.repository.js'
import { ValidationError } from '../../shared/errors.js'
import type { OrderItemInput } from './order.types.js'

export function createOrderRepository(db: Database.Database) {
  const findBook = db.prepare('SELECT * FROM books WHERE id = ?')
  const insertOrder = db.prepare(
    'INSERT INTO orders (customer_name, email, total_cents) VALUES (?, ?, ?)',
  )
  const insertLine = db.prepare(
    'INSERT INTO order_items (order_id, book_id, title, quantity, unit_price_cents) VALUES (?, ?, ?, ?, ?)',
  )
  const reduceStock = db.prepare('UPDATE books SET stock = stock - ? WHERE id = ? AND stock >= ?')

  return {
    saveOrder(name: string, email: string, items: OrderItemInput[]) {
      return db.transaction(() => {
        const lines = items.map((item) => {
          const book = findBook.get(Number(item.bookId)) as BookRow | undefined
          if (!book) throw new ValidationError(`Book ${item.bookId} was not found`)
          if (book.stock < item.quantity)
            throw new ValidationError(`${book.title} has only ${book.stock} in stock`)
          return { book, quantity: item.quantity }
        })
        const totalCents = lines.reduce(
          (total, line) => total + line.book.price_cents * line.quantity,
          0,
        )
        const orderId = Number(insertOrder.run(name, email, totalCents).lastInsertRowid)
        for (const line of lines) {
          if (reduceStock.run(line.quantity, line.book.id, line.quantity).changes !== 1)
            throw new ValidationError(`${line.book.title} is out of stock`)
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
