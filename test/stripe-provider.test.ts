import Stripe from 'stripe'
import { describe, expect, it, vi } from 'vitest'
import { createStripePaymentProvider } from '../src/modules/payments/stripe.provider.js'
import { ProviderRejection } from '../src/modules/payments/payment.provider.js'

function fixture() {
  const client = new Stripe('sk_test_fixture')
  const session = {
    id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/test', expires_at: 2000000000,
    status: 'open', payment_status: 'unpaid', amount_total: 1699, currency: 'usd',
    livemode: false, metadata: { orderId: '1' }, payment_intent: null,
  }
  return { client, session, provider: createStripePaymentProvider('sk_test_fixture', 'whsec_fixture', client) }
}

describe('Stripe test provider', () => {
  it('creates fixed USD card checkout with saved line prices and the same durable operation key', async () => {
    const { client, session, provider } = fixture()
    const create = vi.spyOn(client.checkout.sessions, 'create').mockResolvedValue(session as never)
    const result = await provider.createSession({
      orderId: '1', expiresAt: 2000000000,
      successUrl: 'http://localhost:5173/checkout/return/1?outcome=success',
      cancelUrl: 'http://localhost:5173/checkout/return/1?outcome=cancel',
      lines: [{ title: 'Saved book', quantity: 1, unitPriceCents: 1699 }],
    }, 'create-order-1')
    expect(result).toMatchObject({ id: 'cs_test_1', orderId: '1', amountCents: 1699, paid: false })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'payment', allowed_payment_method_types: ['card'], expires_at: 2000000000,
      metadata: { orderId: '1' }, payment_intent_data: { metadata: { orderId: '1' } },
      line_items: [{ price_data: { currency: 'usd', unit_amount: 1699, product_data: { name: 'Saved book' } }, quantity: 1 }],
      automatic_tax: { enabled: false }, adaptive_pricing: { enabled: false },
    }), { idempotencyKey: 'create-order-1' })
  })

  it('retrieves expanded payment evidence and does not infer paid from the browser redirect', async () => {
    const { client, session, provider } = fixture()
    vi.spyOn(client.checkout.sessions, 'retrieve').mockResolvedValue({ ...session,
      status: 'complete', payment_status: 'paid', payment_intent: {
        id: 'pi_1', amount: 1699, amount_received: 1699, currency: 'usd', status: 'succeeded', metadata: { orderId: '1' },
      },
    } as never)
    expect(await provider.retrieveSession('cs_test_1')).toMatchObject({
      paid: true, paymentIntentId: 'pi_1', intentSucceeded: true,
      intentOrderId: '1', intentAmountCents: 1699, intentCurrency: 'usd',
    })
  })

  it('only classifies a definitive creation rejection as safe to release stock', async () => {
    const { client, provider } = fixture()
    const input = { orderId: '1', expiresAt: 2000000000, successUrl: 'http://localhost:5173', cancelUrl: 'http://localhost:5173', lines: [] }
    const create = vi.spyOn(client.checkout.sessions, 'create')
    create.mockRejectedValueOnce(new Stripe.errors.StripeInvalidRequestError({ message: 'Invalid parameter', statusCode: 400 }))
    await expect(provider.createSession(input, 'key')).rejects.toBeInstanceOf(ProviderRejection)
    create.mockRejectedValueOnce(new Stripe.errors.StripeConnectionError({ message: 'Network lost' }))
    await expect(provider.createSession(input, 'key')).rejects.not.toBeInstanceOf(ProviderRejection)
  })

  it('maps full refund evidence and preserves stable refund idempotency', async () => {
    const { client, provider } = fixture()
    const refund = { id: 're_1', payment_intent: 'pi_1', amount: 1699, currency: 'usd', status: 'pending', metadata: { orderId: '1' }, charge: 'ch_1' }
    const create = vi.spyOn(client.refunds, 'create').mockResolvedValue(refund as never)
    vi.spyOn(client.charges, 'retrieve').mockResolvedValue({ id: 'ch_1', livemode: false } as never)
    expect(await provider.createRefund({ orderId: '1', paymentIntentId: 'pi_1', amountCents: 1699 }, 'refund-1')).toMatchObject({
      id: 're_1', paymentIntentId: 'pi_1', amountCents: 1699, status: 'pending', livemode: false, orderId: '1',
    })
    expect(create).toHaveBeenCalledWith({ payment_intent: 'pi_1', amount: 1699, metadata: { orderId: '1' } }, { idempotencyKey: 'refund-1' })
  })

  it('verifies signed raw bytes and rejects forged or live-mode webhook events', () => {
    const { client, provider } = fixture()
    const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', livemode: false, data: { object: { id: 'cs_test_1' } } })
    const signature = client.webhooks.generateTestHeaderString({ payload, secret: 'whsec_fixture' })
    expect(provider.verifyWebhook(Buffer.from(payload), signature)).toEqual({ id: 'evt_1', type: 'checkout.session.completed', resourceId: 'cs_test_1' })
    expect(() => provider.verifyWebhook(Buffer.from(payload), 'forged')).toThrow()
    const livePayload = payload.replace('"livemode":false', '"livemode":true')
    const liveSignature = client.webhooks.generateTestHeaderString({ payload: livePayload, secret: 'whsec_fixture' })
    expect(() => provider.verifyWebhook(Buffer.from(livePayload), liveSignature)).toThrow('Live')
  })

  it('exposes a definitive refund rejection while retaining uncertain post-refund evidence failures', async () => {
    const { client, provider } = fixture()
    const input = { orderId: '1', paymentIntentId: 'pi_1', amountCents: 1699 }
    const create = vi.spyOn(client.refunds, 'create')
    create.mockRejectedValueOnce(new Stripe.errors.StripeInvalidRequestError({ message: 'Refund rejected', statusCode: 400 }))
    await expect(provider.createRefund(input, 'refund-1')).rejects.toBeInstanceOf(ProviderRejection)
    create.mockResolvedValueOnce({ id: 're_1', charge: 'ch_1', payment_intent: 'pi_1', amount: 1699, currency: 'usd', status: 'succeeded', metadata: { orderId: '1' } } as never)
    vi.spyOn(client.charges, 'retrieve').mockRejectedValueOnce(new Stripe.errors.StripeInvalidRequestError({ message: 'Evidence unavailable', statusCode: 400 }))
    await expect(provider.createRefund(input, 'refund-2')).rejects.not.toBeInstanceOf(ProviderRejection)
  })
})
