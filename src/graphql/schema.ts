export const typeDefs = `#graphql
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
  type OrderItem { title: String!, quantity: Int!, unitPriceCents: Int! }
  type OrderReceipt { id: ID!, totalCents: Int!, items: [OrderItem!]! }
  input OrderItemInput { bookId: ID!, quantity: Int! }
  input PlaceOrderInput { customerName: String!, email: String!, items: [OrderItemInput!]! }
  type Query {
    books(search: String, limit: Int = 12, offset: Int = 0): BookPage!
    book(id: ID!): Book
  }
  type Mutation { placeOrder(input: PlaceOrderInput!): OrderReceipt! }
`
