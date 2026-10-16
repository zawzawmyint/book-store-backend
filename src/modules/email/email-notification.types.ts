export type NotificationKind =
  | 'VERIFY_EMAIL'
  | 'RESET_PASSWORD'
  | 'ORDER_CONFIRMED'
  | 'ORDER_ACCEPTED'
  | 'ORDER_SHIPPED'
  | 'ORDER_CANCELLED'
  | 'ORDER_REFUNDED'
export type EmailQueue = 'AUTH' | 'ORDER'
export type NotificationStatus =
  'PENDING' | 'ENQUEUED' | 'SENDING' | 'SUBMITTED' | 'EXPIRED' | 'SKIPPED' | 'FAILED' | 'UNCERTAIN'
export const TERMINAL_EMAIL_STATUSES: readonly NotificationStatus[] = [
  'SUBMITTED',
  'EXPIRED',
  'SKIPPED',
  'FAILED',
  'UNCERTAIN',
]
export type OrderEmailSnapshot = {
  id: number
  customerName: string
  items: { title: string; quantity: number; unitPriceCents: number }[]
  subtotalCents: number
  deliveryFeeCents: number
  totalCents: number
  currency: string
  eventAt: string
  testPayment: boolean
  address?: {
    recipientName: string
    line1: string
    line2?: string | null
    city: string
    region?: string | null
    postalCode: string | null
    countryCode: string
  }
  carrier?: string | null
  trackingNumber?: string | null
  trackingUrl?: string | null
  cancellationReason?: string | null
  refundStatus?: 'PENDING' | 'REFUNDED' | 'SUPPORT'
}
export type EmailPayload = {
  to: string
  url?: string
  resetToken?: string
  order?: OrderEmailSnapshot
}
export type EncryptedEmailPayload = {
  payloadCiphertext: string
  payloadIv: string
  payloadTag: string
  payloadKeyId: string
}
