export const bookTypeDefs = `#graphql
  type BookCover { url: String!, width: Int!, height: Int! }
  type BookCoverLookup { id: ID!, cover: BookCover }
  type Book {
    cover: BookCover
    id: ID!
    title: String!
    author: String!
    genre: String!
    description: String!
    priceCents: Int!
    stock: Int!
  }
  type BookPage { total: Int!, items: [Book!]! }
  enum CatalogSort { DEFAULT TITLE_ASC PRICE_ASC PRICE_DESC }
  enum AdminBookFilter { ACTIVE ARCHIVED ALL }
  type AdminBook { cover: BookCover, coverRevision: Int!, detailsRevision: Int!, id: ID!, title: String!, author: String!, genre: String!, description: String!, priceCents: Int!, stock: Int!, archived: Boolean! }
  type AdminBooksPage { total: Int!, items: [AdminBook!]! }
  input AdminBookDetailsInput { title: String!, author: String!, genre: String!, description: String!, priceCents: Int! }
  input CreateBookInput { details: AdminBookDetailsInput!, stock: Int! }
  extend type Mutation {
    createBook(input: CreateBookInput!): AdminBook!
    updateBook(id: ID!, input: AdminBookDetailsInput!, expectedRevision: Int): AdminBook!
    adjustBookStock(id: ID!, delta: Int!): AdminBook!
    setBookArchived(id: ID!, archived: Boolean!): AdminBook!
  }
  type Query {
    bookCovers(ids: [ID!]!): [BookCoverLookup!]!
    books(search: String, genre: String, inStockOnly: Boolean = false, minPriceCents: Int, maxPriceCents: Int, sort: CatalogSort = DEFAULT, limit: Int = 12, offset: Int = 0): BookPage!
    genres: [String!]!
    book(id: ID!): Book
    adminBooks(search: String, filter: AdminBookFilter = ACTIVE, lowStockOnly: Boolean = false, limit: Int = 20, offset: Int = 0): AdminBooksPage!
    adminBook(id: ID!): AdminBook
  }
`
