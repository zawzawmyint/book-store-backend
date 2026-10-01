export const bookTypeDefs = `#graphql
  type Book {
    id: ID!
    title: String!
    author: String!
    genre: String!
    description: String!
    priceCents: Int!
    stock: Int!
  }
  type BookPage { total: Int!, items: [Book!]! }
  enum AdminBookFilter { ACTIVE ARCHIVED ALL }
  type AdminBook { id: ID!, title: String!, author: String!, genre: String!, description: String!, priceCents: Int!, stock: Int!, archived: Boolean! }
  type AdminBooksPage { total: Int!, items: [AdminBook!]! }
  input AdminBookDetailsInput { title: String!, author: String!, genre: String!, description: String!, priceCents: Int! }
  input CreateBookInput { details: AdminBookDetailsInput!, stock: Int! }
  extend type Mutation {
    createBook(input: CreateBookInput!): AdminBook!
    updateBook(id: ID!, input: AdminBookDetailsInput!): AdminBook!
    adjustBookStock(id: ID!, delta: Int!): AdminBook!
    setBookArchived(id: ID!, archived: Boolean!): AdminBook!
  }
  type Query {
    books(search: String, limit: Int = 12, offset: Int = 0): BookPage!
    genres: [String!]!
    book(id: ID!): Book
    adminBooks(search: String, filter: AdminBookFilter = ACTIVE, lowStockOnly: Boolean = false, limit: Int = 20, offset: Int = 0): AdminBooksPage!
    adminBook(id: ID!): AdminBook
  }
`
