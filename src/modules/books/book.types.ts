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
export type CatalogOptions = {
  genre?: string | null
  inStockOnly?: boolean | null
  minPriceCents?: number | null
  maxPriceCents?: number | null
  sort?: 'DEFAULT' | 'TITLE_ASC' | 'PRICE_ASC' | 'PRICE_DESC' | null
}

export interface CatalogRepository {
  listBooks(
    search: string,
    limit: number,
    offset: number,
    options?: CatalogOptions,
  ): Promise<BookPage>
  listGenres(): Promise<string[]>
  getBook(id: string): Promise<Book | null>
}
