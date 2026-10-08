import type Database from 'better-sqlite3'
import { count } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { books } from './schema.js'

type SeedBook = {
  title: string
  author: string
  genre: string
  description: string
  priceCents: number
  stock: number
}

export const sampleBooks: SeedBook[] = [
  {
    title: 'The Great Gatsby',
    author: 'F. Scott Fitzgerald',
    genre: 'Classic Fiction',
    description:
      'A luminous portrait of longing, ambition, and the American dream in the Jazz Age.',
    priceCents: 1699,
    stock: 12,
  },
  {
    title: 'Pride and Prejudice',
    author: 'Jane Austen',
    genre: 'Classic Fiction',
    description: 'Elizabeth Bennet discovers that first impressions can be wonderfully misleading.',
    priceCents: 1499,
    stock: 15,
  },
  {
    title: 'The Secret Garden',
    author: 'Frances Hodgson Burnett',
    genre: 'Children’s Literature',
    description: 'A hidden garden becomes a place of friendship, healing, and new beginnings.',
    priceCents: 1399,
    stock: 9,
  },
  {
    title: 'Jane Eyre',
    author: 'Charlotte Brontë',
    genre: 'Classic Fiction',
    description: 'A fiercely independent governess searches for love without surrendering herself.',
    priceCents: 1799,
    stock: 8,
  },
  {
    title: 'Little Women',
    author: 'Louisa May Alcott',
    genre: 'Classic Fiction',
    description:
      'The March sisters grow through love, loss, work, and the pull of their own dreams.',
    priceCents: 1599,
    stock: 11,
  },
  {
    title: 'The Time Machine',
    author: 'H. G. Wells',
    genre: 'Science Fiction',
    description: 'A daring journey into the distant future reveals a startling vision of humanity.',
    priceCents: 1299,
    stock: 7,
  },
  {
    title: 'The Picture of Dorian Gray',
    author: 'Oscar Wilde',
    genre: 'Gothic Fiction',
    description: 'A beautiful portrait bears the cost of a young man’s pursuit of pleasure.',
    priceCents: 1699,
    stock: 10,
  },
  {
    title: 'A Room with a View',
    author: 'E. M. Forster',
    genre: 'Classic Fiction',
    description: 'A trip to Florence opens a young woman’s eyes to a different kind of life.',
    priceCents: 1499,
    stock: 13,
  },
  {
    title: 'The Wonderful Wizard of Oz',
    author: 'L. Frank Baum',
    genre: 'Fantasy',
    description:
      'Dorothy follows the yellow brick road toward home and finds courage along the way.',
    priceCents: 1399,
    stock: 14,
  },
  {
    title: 'Dracula',
    author: 'Bram Stoker',
    genre: 'Gothic Fiction',
    description: 'An unforgettable tale of terror unfolds across the shadows of Victorian England.',
    priceCents: 1899,
    stock: 6,
  },
  {
    title: 'The Call of the Wild',
    author: 'Jack London',
    genre: 'Adventure',
    description: 'Buck answers the wild call of the Yukon in a story of survival and instinct.',
    priceCents: 1299,
    stock: 10,
  },
  {
    title: 'Anne of Green Gables',
    author: 'L. M. Montgomery',
    genre: 'Children’s Literature',
    description: 'An imaginative orphan transforms the lives of everyone at Green Gables.',
    priceCents: 1599,
    stock: 12,
  },
]

export function seedBooks(db: Database.Database): void {
  const orm = drizzle(db)
  orm.transaction((tx) => {
    if (tx.select({ count: count() }).from(books).get()!.count > 0) return
    tx.insert(books).values(sampleBooks).run()
  })
}
