export const orderTypeDefs = `#graphql
 enum OrderStatus { SUBMITTED PREPARING SHIPPED DELIVERED CANCELLED }
 enum OrderStatusFilter { ALL SUBMITTED PREPARING SHIPPED DELIVERED CANCELLED }
 type OrderStatusEvent { id: ID!, fromStatus: OrderStatus, toStatus: OrderStatus!, createdAt: String!, cancellationReason: String }
 enum ActorType { USER SYSTEM }
 enum PaymentStatus { PENDING PAID EXPIRED REFUND_PENDING REFUNDED REFUND_FAILED }
 type OrderPayment { cancellationPending: Boolean!, required: Boolean!, status: PaymentStatus!, currency: String!, expiresAt: String, paidAt: String, refundedAt: String }
 type AdminOrderStatusEvent { id: ID!, fromStatus: OrderStatus, toStatus: OrderStatus!, createdAt: String!, cancellationReason: String, actorName: String!, actorRole: UserRole, actorType: ActorType! }
 type OrderItem { title: String!, quantity: Int!, unitPriceCents: Int! }
 type OrderReceipt { id: ID!, subtotalCents: Int!, deliveryFeeCents: Int!, delivery: OrderDelivery!, totalCents: Int!, items: [OrderItem!]!, status: OrderStatus!, payment: OrderPayment! }
 type OrderHistoryEntry { id: ID!, createdAt: String!, subtotalCents: Int!, deliveryFeeCents: Int!, delivery: OrderDelivery!, totalCents: Int!, items: [OrderItem!]!, status: OrderStatus!, payment: OrderPayment! }
 type MyOrder { id: ID!, createdAt: String!, subtotalCents: Int!, deliveryFeeCents: Int!, delivery: OrderDelivery!, totalCents: Int!, items: [OrderItem!]!, status: OrderStatus!, history: [OrderStatusEvent!]!, payment: OrderPayment! }
 type MyOrdersPage { total: Int!, items: [OrderHistoryEntry!]! }
 type AdminOrder { id: ID!, userId: ID, customerName: String!, email: String!, createdAt: String!, subtotalCents: Int!, deliveryFeeCents: Int!, delivery: OrderDelivery!, totalCents: Int!, items: [OrderItem!]!, status: OrderStatus!, history: [AdminOrderStatusEvent!]!, payment: OrderPayment! }
 type AdminOrdersPage { total: Int!, items: [AdminOrder!]! }
 input DeliveryAddressInput { recipientName: String!, phone: String!, addressLine1: String!, addressLine2: String, city: String!, region: String, postalCode: String, countryCode: String! }
 type DeliveryAddress { recipientName: String!, phone: String!, addressLine1: String!, addressLine2: String, city: String!, region: String, postalCode: String, countryCode: String! }
 input ShipmentInput { carrier: String!, trackingNumber: String, trackingUrl: String }
 type Shipment { carrier: String!, trackingNumber: String, trackingUrl: String }
 type OrderDelivery { address: DeliveryAddress!, shipment: Shipment, shippedAt: String, deliveredAt: String }
 type DeliveryOptions { countryCodes: [String!]!, feeCents: Int!, currency: String! }
 input QuoteCheckoutInput { items: [OrderItemInput!]!, deliveryAddress: DeliveryAddressInput! }
 type CheckoutQuote { subtotalCents: Int!, deliveryFeeCents: Int!, totalCents: Int!, currency: String! }
 extend type Query {
 deliveryOptions: DeliveryOptions!
 quoteCheckout(input: QuoteCheckoutInput!): CheckoutQuote!
 adminOrders(limit: Int = 20, offset: Int = 0, status: OrderStatusFilter = ALL): AdminOrdersPage!
 adminOrder(id: ID!): AdminOrder
 myOrder(id: ID!): MyOrder
 myOrders(limit: Int = 20, offset: Int = 0): MyOrdersPage!
 }
 input OrderItemInput { bookId: ID!, quantity: Int! }
 input PlaceOrderInput { items: [OrderItemInput!]! }
 input SetOrderStatusInput { id: ID!, expectedStatus: OrderStatus!, status: OrderStatus!, cancellationReason: String, shipment: ShipmentInput }
 input CreateCheckoutInput { items: [OrderItemInput!]!, requestKey: String!, deliveryAddress: DeliveryAddressInput!, expectedDeliveryFeeCents: Int!, expectedTotalCents: Int! }
 type CheckoutResult { order: MyOrder!, checkoutUrl: String }
 type Mutation { placeOrder(input: PlaceOrderInput!): OrderReceipt! @deprecated(reason: "Use createCheckout"), setOrderStatus(input: SetOrderStatusInput!): AdminOrder!, createCheckout(input: CreateCheckoutInput!): CheckoutResult!, resumeCheckout(orderId: ID!): CheckoutResult!, refreshOrderPayment(orderId: ID!): MyOrder!, retryOrderRefund(orderId: ID!): AdminOrder! }
`
