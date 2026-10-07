import type { orders } from '../../database/schema.js'
export type OrderPayment = {
  required: boolean
  status: typeof orders.$inferSelect.paymentStatus
  currency: string
  expiresAt: string | null
  paidAt: string | null
  refundedAt: string | null
}
export function orderPayment(row: typeof orders.$inferSelect): OrderPayment {
  return {
    required: row.paymentRequired,
    status: row.paymentStatus,
    currency: row.currency,
    expiresAt: row.expiresAt,
    paidAt: row.paidAt,
    refundedAt: row.refundedAt,
  }
}
