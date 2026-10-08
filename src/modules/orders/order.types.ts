import type { DeliveryAddress, OrderDelivery } from './delivery.validation.js'
export type OrderStatus = 'SUBMITTED' | 'PREPARING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED'
export type OrderItemInput = { bookId: string; quantity: number }

export type OrderInput = {
  items: OrderItemInput[]
}

export type OrderCustomer = { id: string; name: string; email: string }

export type OrderReceipt = {
  id: string
  status: OrderStatus
  subtotalCents: number
  deliveryFeeCents: number
  delivery: OrderDelivery
  totalCents: number
  items: { title: string; quantity: number; unitPriceCents: number }[]
}

export type OrderHistory = {
  total: number
  items: {
    id: string
    createdAt: string
    status: OrderStatus
    subtotalCents: number
    deliveryFeeCents: number
    delivery?: OrderDelivery
    totalCents: number
    payment: import('../payments/payment.types.js').OrderPayment
    items: OrderReceipt['items']
  }[]
}

export type CustomerOrder = OrderHistory['items'][number] & {
  history: {
    id: string
    fromStatus: OrderStatus | null
    toStatus: OrderStatus
    createdAt: string
    cancellationReason: string | null
  }[]
}
export interface OrderRepository {
  getOrderForUser(userId: string, id: string): Promise<CustomerOrder | null>
  saveOrder(
    customer: OrderCustomer,
    items: OrderItemInput[],
    delivery: { address: DeliveryAddress; feeCents: number },
  ): Promise<OrderReceipt>
  listOrders(userId: string, limit: number, offset: number): Promise<OrderHistory>
}

export type WorkspaceOrder = {
  id: string
  userId: string | null
  customerName: string
  email: string
  createdAt: string
  subtotalCents: number
  deliveryFeeCents: number
  delivery?: OrderDelivery
  totalCents: number
  status: OrderStatus
  items: OrderReceipt['items']
}
