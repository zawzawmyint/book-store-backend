import type Database from 'better-sqlite3'
import type { BookRow } from '../modules/books/book.repository.js'

const sampleBooks: Array<Omit<BookRow, 'id'>> = [
  {
    title: 'The Great Gatsby',
    author: 'F. Scott Fitzgerald',
    genre: 'Classic Fiction',
    description:
      'A luminous portrait of longing, ambition, and the American dream in the Jazz Age.',
    price_cents: 1699,
    stock: 12,
  },
  {
    title: 'Pride and Prejudice',
    author: 'Jane Austen',
    genre: 'Classic Fiction',
    description: 'Elizabeth Bennet discovers that first impressions can be wonderfully misleading.',
    price_cents: 1499,
    stock: 15,
  },
  {
    title: 'The Secret Garden',
    author: 'Frances Hodgson Burnett',
    genre: 'Children’s Literature',
    description: 'A hidden garden becomes a place of friendship, healing, and new beginnings.',
    price_cents: 1399,
    stock: 9,
  },
  {
    title: 'Jane Eyre',
    author: 'Charlotte Brontë',
    genre: 'Classic Fiction',
    description: 'A fiercely independent governess searches for love without surrendering herself.',
    price_cents: 1799,
    stock: 8,
  },
  {
    title: 'Little Women',
    author: 'Louisa May Alcott',
    genre: 'Classic Fiction',
    description:
      'The March sisters grow through love, loss, work, and the pull of their own dreams.',
    price_cents: 1599,
    stock: 11,
  },
  {
    title: 'The Time Machine',
    author: 'H. G. Wells',
    genre: 'Science Fiction',
    description: 'A daring journey into the distant future reveals a startling vision of humanity.',
    price_cents: 1299,
    stock: 7,
  },
  {
    title: 'The Picture of Dorian Gray',
    author: 'Oscar Wilde',
    genre: 'Gothic Fiction',
    description: 'A beautiful portrait bears the cost of a young man’s pursuit of pleasure.',
    price_cents: 1699,
    stock: 10,
  },
  {
    title: 'A Room with a View',
    author: 'E. M. Forster',
    genre: 'Classic Fiction',
    description: 'A trip to Florence opens a young woman’s eyes to a different kind of life.',
    price_cents: 1499,
    stock: 13,
  },
  {
    title: 'The Wonderful Wizard of Oz',
    author: 'L. Frank Baum',
    genre: 'Fantasy',
    description:
      'Dorothy follows the yellow brick road toward home and finds courage along the way.',
    price_cents: 1399,
    stock: 14,
  },
  {
    title: 'Dracula',
    author: 'Bram Stoker',
    genre: 'Gothic Fiction',
    description: 'An unforgettable tale of terror unfolds across the shadows of Victorian England.',
    price_cents: 1899,
    stock: 6,
  },
  {
    title: 'The Call of the Wild',
    author: 'Jack London',
    genre: 'Adventure',
    description: 'Buck answers the wild call of the Yukon in a story of survival and instinct.',
    price_cents: 1299,
    stock: 10,
  },
  {
    title: 'Anne of Green Gables',
    author: 'L. M. Montgomery',
    genre: 'Children’s Literature',
    description: 'An imaginative orphan transforms the lives of everyone at Green Gables.',
    price_cents: 1599,
    stock: 12,
  },
]

export function seedBooks(db: Database.Database): void {
  const count = db.prepare('SELECT COUNT(*) AS count FROM books').get() as { count: number }
  if (count.count > 0) return
  const insert = db.prepare(
    'INSERT INTO books (title, author, genre, description, price_cents, stock) VALUES (@title, @author, @genre, @description, @price_cents, @stock)',
  )
  db.transaction(() => {
    for (const book of sampleBooks) insert.run(book)
  })()
}
