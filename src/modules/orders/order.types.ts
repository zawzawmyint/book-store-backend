export type OrderItemInput = { bookId: string; quantity: number }

export type OrderInput = {
  items: OrderItemInput[]
}

export type OrderCustomer = { id: string; name: string; email: string }

export type OrderReceipt = {
  id: string
  totalCents: number
  items: { title: string; quantity: number; unitPriceCents: number }[]
}

export type OrderHistory = {
  total: number
  items: {
    id: string
    createdAt: string
    totalCents: number
    items: OrderReceipt['items']
  }[]
}

export interface OrderRepository {
  saveOrder(customer: OrderCustomer, items: OrderItemInput[]): OrderReceipt
  listOrders(userId: string, limit: number, offset: number): OrderHistory
}
