import { createOrderRepository as actualOrderRepository } from '../src/modules/orders/order.repository.js'
import { normalizeStore, type DatabaseInput } from '../src/database/persistence.js'
import type { OrderCustomer, OrderItemInput } from '../src/modules/orders/order.types.js'
export const deliveryAddress = {
  recipientName: 'Buyer',
  phone: '+1 555 123 4567',
  addressLine1: '12 Main Street',
  addressLine2: null,
  city: 'City',
  region: null,
  postalCode: null,
  countryCode: 'US',
}
export const deliveryOptions = {
  deliveryEnabled: true,
  deliveryCountryCodes: ['US'],
  deliveryFeeCents: 500,
}
// Existing repository tests explicitly seed paid snapshots; production cannot omit a destination.
export function createOrderRepository(input: DatabaseInput) {
  const repository = actualOrderRepository(input)
  return {
    ...repository,
    async saveOrder(customer: OrderCustomer, items: OrderItemInput[]) {
      const saved = await repository.saveOrder(customer, items, {
        address: deliveryAddress,
        feeCents: 0,
      })
      await normalizeStore(input).updateOrder(Number(saved.id), {
        paymentStatus: 'PAID',
        paidAt: new Date().toISOString(),
      })
      return saved
    },
  }
}
export function reviewedInput(
  db: { prepare: (sql: string) => { get: (id: string) => unknown } },
  input: { requestKey: string; items: OrderItemInput[] },
) {
  const subtotal = input.items.reduce(
    (sum, item) =>
      sum +
      ((
        db.prepare('SELECT price_cents FROM books WHERE id=?').get(item.bookId) as
          { price_cents: number } | undefined
      )?.price_cents ?? 0) *
        item.quantity,
    0,
  )
  return {
    ...input,
    deliveryAddress,
    expectedDeliveryFeeCents: 500,
    expectedTotalCents: subtotal + 500,
  }
}
export function reviewedInlineCheckout(
  db: { prepare: (sql: string) => { get: (id: string) => unknown } },
  query: string,
) {
  return query.replace(/createCheckout\(input:\s*\{([\s\S]*?)\}\)/g, (match, input: string) => {
    const items = [...input.matchAll(/bookId:\s*"(\d+)"\s*,\s*quantity:\s*(\d+)/g)].map((m) => ({
      bookId: m[1],
      quantity: Number(m[2]),
    }))
    const reviewed = reviewedInput(db, { requestKey: '', items })
    return match.replace(
      /\}\)$/,
      `,deliveryAddress:{recipientName:"Buyer",phone:"+1 555 123 4567",addressLine1:"12 Main Street",city:"City",countryCode:"US"},expectedDeliveryFeeCents:500,expectedTotalCents:${reviewed.expectedTotalCents}})`,
    )
  })
}
