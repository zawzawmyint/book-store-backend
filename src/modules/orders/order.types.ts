export type OrderStatus = 'SUBMITTED' | 'ACCEPTED' | 'COMPLETED' | 'CANCELLED'
export type OrderItemInput = { bookId: string; quantity: number }

export type OrderInput = {
  items: OrderItemInput[]
}

export type OrderCustomer = { id: string; name: string; email: string }

export type OrderReceipt = {
  id: string
  status: OrderStatus
  totalCents: number
  items: { title: string; quantity: number; unitPriceCents: number }[]
}

export type OrderHistory = {
  total: number
  items: {
    id: string
    createdAt: string
    status: OrderStatus
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
  getOrderForUser(userId: string, id: string): CustomerOrder | null
  saveOrder(customer: OrderCustomer, items: OrderItemInput[]): OrderReceipt
  listOrders(userId: string, limit: number, offset: number): OrderHistory
}

export type WorkspaceOrder = {
  id: string
  userId: string | null
  customerName: string
  email: string
  createdAt: string
  totalCents: number
  status: OrderStatus
  items: OrderReceipt['items']
}
