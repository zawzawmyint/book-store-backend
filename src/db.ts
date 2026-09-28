import Database from 'better-sqlite3'

export type BookRow = {
  id: number
  title: string
  author: string
  genre: string
  description: string
  price_cents: number
  stock: number
}

const seedBooks: Array<Omit<BookRow, 'id'>> = [
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

export function createDatabase(path: string): Database.Database {
  const db = new Database(path)
  db.pragma('foreign_keys = ON')
  db.pragma('journal_mode = WAL')
  const version = db.pragma('user_version', { simple: true }) as number
  if (version > 1) throw new Error(`Unsupported database version: ${version}`)
  if (version === 0) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      genre TEXT NOT NULL,
      description TEXT NOT NULL,
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
      stock INTEGER NOT NULL CHECK (stock >= 0)
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      email TEXT NOT NULL,
      total_cents INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      book_id INTEGER NOT NULL REFERENCES books(id),
      title TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price_cents INTEGER NOT NULL
    );
  `)
    db.pragma('user_version = 1')
  }

  const count = db.prepare('SELECT COUNT(*) AS count FROM books').get() as { count: number }
  if (count.count === 0) {
    const insert = db.prepare(
      'INSERT INTO books (title, author, genre, description, price_cents, stock) VALUES (@title, @author, @genre, @description, @price_cents, @stock)',
    )
    db.transaction(() => {
      for (const book of seedBooks) insert.run(book)
    })()
  }
  return db
}
