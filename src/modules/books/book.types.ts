export type Book = {
  id: number
  title: string
  author: string
  genre: string
  description: string
  priceCents: number
  stock: number
}

export type BookPage = { total: number; items: Book[] }

export interface CatalogRepository {
  listBooks(search: string, limit: number, offset: number): BookPage
  listGenres(): string[]
  getBook(id: string): Book | null
}
