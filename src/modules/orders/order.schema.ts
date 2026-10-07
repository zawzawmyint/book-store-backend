export const orderTypeDefs = `#graphql
 enum OrderStatus { SUBMITTED ACCEPTED COMPLETED CANCELLED }
 enum OrderStatusFilter { ALL SUBMITTED ACCEPTED COMPLETED CANCELLED }
 type OrderStatusEvent { id: ID!, fromStatus: OrderStatus, toStatus: OrderStatus!, createdAt: String!, cancellationReason: String }
 enum ActorType { USER SYSTEM }
 enum PaymentStatus { LEGACY_UNPAID PENDING PAID EXPIRED REFUND_PENDING REFUNDED REFUND_FAILED }
 type OrderPayment { required: Boolean!, status: PaymentStatus!, currency: String!, expiresAt: String, paidAt: String, refundedAt: String }
 type AdminOrderStatusEvent { id: ID!, fromStatus: OrderStatus, toStatus: OrderStatus!, createdAt: String!, cancellationReason: String, actorName: String!, actorRole: UserRole, actorType: ActorType! }
 type OrderItem { title: String!, quantity: Int!, unitPriceCents: Int! }
 type OrderReceipt { id: ID!, totalCents: Int!, items: [OrderItem!]!, status: OrderStatus!, payment: OrderPayment! }
 type OrderHistoryEntry { id: ID!, createdAt: String!, totalCents: Int!, items: [OrderItem!]!, status: OrderStatus!, payment: OrderPayment! }
 type MyOrder { id: ID!, createdAt: String!, totalCents: Int!, items: [OrderItem!]!, status: OrderStatus!, history: [OrderStatusEvent!]!, payment: OrderPayment! }
 type MyOrdersPage { total: Int!, items: [OrderHistoryEntry!]! }
 type AdminOrder { id: ID!, userId: ID, customerName: String!, email: String!, createdAt: String!, totalCents: Int!, items: [OrderItem!]!, status: OrderStatus!, history: [AdminOrderStatusEvent!]!, payment: OrderPayment! }
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
 input CreateCheckoutInput { items: [OrderItemInput!]!, requestKey: String! }
 type CheckoutResult { order: MyOrder!, checkoutUrl: String }
 type Mutation { placeOrder(input: PlaceOrderInput!): OrderReceipt! @deprecated(reason: "Use createCheckout"), setOrderStatus(input: SetOrderStatusInput!): AdminOrder!, createCheckout(input: CreateCheckoutInput!): CheckoutResult!, resumeCheckout(orderId: ID!): CheckoutResult!, refreshOrderPayment(orderId: ID!): MyOrder!, retryOrderRefund(orderId: ID!): AdminOrder! }
`
