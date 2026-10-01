export const orderTypeDefs = `#graphql
  type OrderItem { title: String!, quantity: Int!, unitPriceCents: Int! }
  type OrderReceipt { id: ID!, totalCents: Int!, items: [OrderItem!]! }
  type OrderHistoryEntry { id: ID!, createdAt: String!, totalCents: Int!, items: [OrderItem!]! }
  type MyOrdersPage { total: Int!, items: [OrderHistoryEntry!]! }
  type AdminOrder { id: ID!, userId: ID, customerName: String!, email: String!, createdAt: String!, totalCents: Int!, items: [OrderItem!]! }
  type AdminOrdersPage { total: Int!, items: [AdminOrder!]! }
  extend type Query {
    adminOrders(limit: Int = 20, offset: Int = 0): AdminOrdersPage!
    adminOrder(id: ID!): AdminOrder
  }
  input OrderItemInput { bookId: ID!, quantity: Int! }
  input PlaceOrderInput { items: [OrderItemInput!]! }
  extend type Query { myOrders(limit: Int = 20, offset: Int = 0): MyOrdersPage! }
  type Mutation { placeOrder(input: PlaceOrderInput!): OrderReceipt! }
`
