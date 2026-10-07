import Stripe from 'stripe'
import {
  ProviderRejection,
  type PaymentProvider,
  type ProviderRefund,
  type ProviderSession,
} from './payment.provider.js'

function sessionEvidence(session: Stripe.Checkout.Session): ProviderSession {
  if (session.livemode) throw new Error('Live payments are disabled')
  const intent = typeof session.payment_intent === 'object' ? session.payment_intent : null
  if (!['open', 'complete', 'expired'].includes(session.status ?? ''))
    throw new Error('Unknown Checkout Session state')
  return {
    id: session.id,
    paymentIntentId:
      typeof session.payment_intent === 'string' ? session.payment_intent : (intent?.id ?? null),
    url: session.url,
    expiresAt: session.expires_at,
    status: session.status as ProviderSession['status'],
    paid: session.payment_status === 'paid',
    amountCents: session.amount_total ?? -1,
    currency: session.currency ?? '',
    livemode: session.livemode,
    orderId: session.metadata?.orderId ?? '',
    intentOrderId: intent?.metadata.orderId ?? null,
    intentAmountCents: intent?.amount_received ?? null,
    intentCurrency: intent?.currency ?? null,
    intentSucceeded: intent?.status === 'succeeded',
  }
}

export function createStripePaymentProvider(
  key: string,
  webhookSecret: string,
  client?: Stripe,
): PaymentProvider {
  if (!/^(sk|rk)_test_/.test(key)) throw new Error('Only Stripe test keys are supported')
  const stripe = client ?? new Stripe(key, { timeout: 15000, maxNetworkRetries: 0 })

  async function refundEvidence(refund: Stripe.Refund): Promise<ProviderRefund> {
    // Refunds have no livemode field: the associated charge supplies it.
    const charge =
      typeof refund.charge === 'string'
        ? await stripe.charges.retrieve(refund.charge)
        : refund.charge
    if (!charge || charge.livemode) throw new Error('Live or unverified refunds are disabled')
    const status =
      refund.status === 'succeeded'
        ? 'succeeded'
        : refund.status === 'failed' || refund.status === 'canceled'
          ? 'failed'
          : 'pending'
    return {
      id: refund.id,
      paymentIntentId:
        typeof refund.payment_intent === 'string'
          ? refund.payment_intent
          : (refund.payment_intent?.id ?? ''),
      amountCents: refund.amount,
      currency: refund.currency,
      status,
      livemode: charge.livemode,
      orderId: refund.metadata?.orderId ?? '',
    }
  }

  async function retrieveSession(id: string) {
    return sessionEvidence(
      await stripe.checkout.sessions.retrieve(id, { expand: ['payment_intent'] }),
    )
  }

  return {
    async createSession(input, idempotencyKey) {
      try {
        const session = await stripe.checkout.sessions.create(
          {
            mode: 'payment',
            ui_mode: 'hosted_page',
            allowed_payment_method_types: ['card'],
            expires_at: input.expiresAt,
            success_url: input.successUrl,
            cancel_url: input.cancelUrl,
            client_reference_id: input.orderId,
            metadata: { orderId: input.orderId },
            payment_intent_data: { metadata: { orderId: input.orderId } },
            line_items: input.lines.map((line) => ({
              price_data: {
                currency: 'usd',
                unit_amount: line.unitPriceCents,
                product_data: { name: line.title },
              },
              quantity: line.quantity,
            })),
            automatic_tax: { enabled: false },
            adaptive_pricing: { enabled: false },
            allow_promotion_codes: false,
            expand: ['payment_intent'],
          },
          { idempotencyKey },
        )
        return sessionEvidence(session)
      } catch (error) {
        // Timeouts, connection errors, conflicts and rate limits remain uncertain.
        if (error instanceof Stripe.errors.StripeInvalidRequestError && error.statusCode === 400) {
          throw new ProviderRejection('Checkout request was rejected')
        }
        throw error
      }
    },
    retrieveSession,
    async expireSession(id) {
      try {
        await stripe.checkout.sessions.expire(id)
      } catch (error) {
        // A payment may have completed while the expiration request was in flight.
        if (!(error instanceof Stripe.errors.StripeInvalidRequestError)) throw error
      }
      return retrieveSession(id)
    },
    async createRefund(input, idempotencyKey) {
      let refund: Stripe.Refund
      try {
        refund = await stripe.refunds.create(
          {
            payment_intent: input.paymentIntentId,
            amount: input.amountCents,
            metadata: { orderId: input.orderId },
          },
          { idempotencyKey },
        )
      } catch (error) {
        if (error instanceof Stripe.errors.StripeInvalidRequestError && error.statusCode === 400) {
          throw new ProviderRejection('Refund request was rejected')
        }
        throw error
      }
      // Evidence lookup failure occurs after creation; retry the same operation.
      return refundEvidence(refund)
    },
    async retrieveRefund(id) {
      return refundEvidence(await stripe.refunds.retrieve(id))
    },
    verifyWebhook(body, signature) {
      const event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
      if (event.livemode) throw new Error('Live webhook events are disabled')
      const object = event.data.object as { id?: string }
      return { id: event.id, type: event.type, resourceId: object.id ?? '' }
    },
  }
}
