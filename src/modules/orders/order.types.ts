export type OrderItemInput = { bookId: string; quantity: number }

export type OrderInput = {
  customerName: string
  email: string
  items: OrderItemInput[]
}
