export type ProviderSession = {
  id: string
  paymentIntentId: string | null
  url: string | null
  expiresAt: number
  status: 'open' | 'complete' | 'expired'
  paid: boolean
  amountCents: number
  currency: string
  livemode: boolean
  orderId: string
  intentOrderId: string | null
  intentAmountCents: number | null
  intentCurrency: string | null
  intentSucceeded: boolean
}
export type ProviderRefund = {
  id: string
  paymentIntentId: string
  amountCents: number
  currency: string
  status: 'pending' | 'succeeded' | 'failed'
  livemode: boolean
  orderId: string
}
export type ProviderEvent = { id: string; type: string; resourceId: string }
export type CreateSessionRequest = {
  orderId: string
  expiresAt: number
  successUrl: string
  cancelUrl: string
  lines: { title: string; quantity: number; unitPriceCents: number }[]
}
export interface PaymentProvider {
  createSession(input: CreateSessionRequest, idempotencyKey: string): Promise<ProviderSession>
  retrieveSession(id: string): Promise<ProviderSession>
  expireSession(id: string): Promise<ProviderSession>
  createRefund(
    input: { orderId: string; paymentIntentId: string; amountCents: number },
    idempotencyKey: string,
  ): Promise<ProviderRefund>
  retrieveRefund(id: string): Promise<ProviderRefund>
  verifyWebhook(body: Buffer, signature: string): ProviderEvent
}
// Only a definitive rejection of a create request permits releasing its reservation.
export class ProviderRejection extends Error {}
