export const orderTypeDefs = `#graphql
 enum OrderStatus { SUBMITTED ACCEPTED COMPLETED CANCELLED }
 enum OrderStatusFilter { ALL SUBMITTED ACCEPTED COMPLETED CANCELLED }
 type OrderStatusEvent { id: ID!, fromStatus: OrderStatus, toStatus: OrderStatus!, createdAt: String!, cancellationReason: String }
 type AdminOrderStatusEvent { id: ID!, fromStatus: OrderStatus, toStatus: OrderStatus!, createdAt: String!, cancellationReason: String, actorName: String!, actorRole: UserRole! }
 type OrderItem { title: String!, quantity: Int!, unitPriceCents: Int! }
 type OrderReceipt { id: ID!, totalCents: Int!, items: [OrderItem!]!, status: OrderStatus! }
 type OrderHistoryEntry { id: ID!, createdAt: String!, totalCents: Int!, items: [OrderItem!]!, status: OrderStatus! }
 type MyOrder { id: ID!, createdAt: String!, totalCents: Int!, items: [OrderItem!]!, status: OrderStatus!, history: [OrderStatusEvent!]! }
 type MyOrdersPage { total: Int!, items: [OrderHistoryEntry!]! }
 type AdminOrder { id: ID!, userId: ID, customerName: String!, email: String!, createdAt: String!, totalCents: Int!, items: [OrderItem!]!, status: OrderStatus!, history: [AdminOrderStatusEvent!]! }
 type AdminOrdersPage { total: Int!, items: [AdminOrder!]! }
 extend type Query {
 adminOrders(limit: Int = 20, offset: Int = 0, status: OrderStatusFilter = ALL): AdminOrdersPage!
 adminOrder(id: ID!): AdminOrder
 myOrder(id: ID!): MyOrder
 myOrders(limit: Int = 20, offset: Int = 0): MyOrdersPage!
 }
 input OrderItemInput { bookId: ID!, quantity: Int! }
 input PlaceOrderInput { items: [OrderItemInput!]! }
 input SetOrderStatusInput { id: ID!, expectedStatus: OrderStatus!, status: OrderStatus!, cancellationReason: String }
 type Mutation { placeOrder(input: PlaceOrderInput!): OrderReceipt!, setOrderStatus(input: SetOrderStatusInput!): AdminOrder! }
`
