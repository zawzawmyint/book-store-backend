import type {
  CreateSessionRequest,
  PaymentProvider,
  ProviderRefund,
  ProviderSession,
} from '../src/modules/payments/payment.provider.js'

export class FakePaymentProvider implements PaymentProvider {
  sessions = new Map<string, ProviderSession>()
  refunds = new Map<string, ProviderRefund>()
  sessionKeys = new Map<string, string>()
  refundKeys = new Map<string, string>()
  uncertainCreate = false
  unavailable = false
  refundStatus: ProviderRefund['status'] = 'succeeded'
  async createSession(input: CreateSessionRequest, key: string) {
    if (this.unavailable) throw new Error('provider offline')
    const existing = this.sessionKeys.get(key)
    if (existing) return this.retrieveSession(existing)
    const id = `cs_test_${this.sessions.size + 1}`
    const session: ProviderSession = {
      id,
      paymentIntentId: null,
      url: `https://checkout.stripe.com/${id}`,
      expiresAt: input.expiresAt,
      status: 'open',
      paid: false,
      amountCents: input.lines.reduce((n, l) => n + l.quantity * l.unitPriceCents, 0),
      currency: 'usd',
      livemode: false,
      orderId: input.orderId,
      intentOrderId: null,
      intentAmountCents: null,
      intentCurrency: null,
      intentSucceeded: false,
    }
    this.sessions.set(id, session)
    this.sessionKeys.set(key, id)
    if (this.uncertainCreate) {
      this.uncertainCreate = false
      throw new Error('lost response')
    }
    return structuredClone(session)
  }
  async retrieveSession(id: string) {
    if (this.unavailable) throw new Error('offline')
    return structuredClone(this.sessions.get(id)!)
  }
  async expireSession(id: string) {
    if (this.unavailable) throw new Error('offline')
    const session = this.sessions.get(id)!
    if (!session.paid) {
      session.status = 'expired'
      session.url = null
    }
    return structuredClone(session)
  }
  pay(id: string) {
    const s = this.sessions.get(id)!
    Object.assign(s, {
      status: 'complete',
      paid: true,
      paymentIntentId: `pi_${id}`,
      intentOrderId: s.orderId,
      intentAmountCents: s.amountCents,
      intentCurrency: s.currency,
      intentSucceeded: true,
      url: null,
    })
  }
  async createRefund(
    input: { orderId: string; paymentIntentId: string; amountCents: number },
    key: string,
  ) {
    if (this.unavailable) throw new Error('offline')
    const existing = this.refundKeys.get(key)
    if (existing) return this.retrieveRefund(existing)
    const refund: ProviderRefund = {
      id: `re_${this.refunds.size + 1}`,
      ...input,
      currency: 'usd',
      status: this.refundStatus,
      livemode: false,
    }
    this.refunds.set(refund.id, refund)
    this.refundKeys.set(key, refund.id)
    return structuredClone(refund)
  }
  async retrieveRefund(id: string) {
    if (this.unavailable) throw new Error('offline')
    return structuredClone(this.refunds.get(id)!)
  }
  verifyWebhook(body: Buffer, signature: string) {
    if (signature !== 'valid') throw new Error('invalid')
    return JSON.parse(body.toString())
  }
}
