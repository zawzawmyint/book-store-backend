import { expect, it } from 'vitest'
import { loadConfig } from '../src/config/env.js'
import { checkoutInputSchema } from '../src/modules/payments/payment.validation.js'
import { shipmentSchema, deliveryAddressSchema } from '../src/modules/orders/delivery.validation.js'
import { setOrderStatusSchema } from '../src/modules/orders/order.validation.js'

const address = {
  recipientName: ' Buyer ',
  phone: '+1 555 123 4567',
  addressLine1: ' 12 Main ',
  addressLine2: ' ',
  city: ' City ',
  countryCode: ' us ',
}
it('requires an explicit delivery fee and countries when enabled', () => {
  const env = { BETTER_AUTH_SECRET: 'x'.repeat(32), DELIVERY_ENABLED: 'true' }
  expect(() => loadConfig(env)).toThrow('DELIVERY')
  expect(
    loadConfig({ ...env, DELIVERY_COUNTRY_CODES: 'US', DELIVERY_FEE_CENTS: '0' }),
  ).toMatchObject({ deliveryEnabled: true, deliveryCountryCodes: ['US'], deliveryFeeCents: 0 })
})
it.each(['', '500.5', '-1', '2147483648'])('rejects invalid enabled delivery fee %s', (fee) => {
  expect(() =>
    loadConfig({
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      DELIVERY_ENABLED: 'true',
      DELIVERY_COUNTRY_CODES: 'US',
      DELIVERY_FEE_CENTS: fee,
    }),
  ).toThrow('DELIVERY_FEE_CENTS')
})
it('rejects unassigned ISO countries and unsafe private text', () => {
  expect(() =>
    loadConfig({
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      DELIVERY_ENABLED: 'true',
      DELIVERY_COUNTRY_CODES: 'ZZ',
      DELIVERY_FEE_CENTS: '500',
    }),
  ).toThrow('DELIVERY_COUNTRY_CODES')
  for (const override of [
    { phone: '123456' },
    { recipientName: 'Name\n' },
    { addressLine1: 'Street\u0000' },
  ])
    expect(deliveryAddressSchema.safeParse({ ...address, ...override }).success).toBe(false)
})
it('validates shipment links and allows shipment only for dispatch', () => {
  for (const trackingUrl of [
    'http://carrier.example/1',
    'https://user:secret@carrier.example/1',
    'javascript:alert(1)',
  ])
    expect(
      shipmentSchema.safeParse({ carrier: 'Carrier', trackingNumber: 'A1', trackingUrl }).success,
    ).toBe(false)
  expect(
    shipmentSchema.safeParse({ carrier: 'Carrier', trackingUrl: 'https://carrier.example/1' })
      .success,
  ).toBe(false)
  expect(
    setOrderStatusSchema.safeParse({
      id: '1',
      expectedStatus: 'SHIPPED',
      status: 'DELIVERED',
      shipment: { carrier: 'Carrier' },
    }).success,
  ).toBe(false)
})
it('requires reviewed money and normalizes private delivery input', () => {
  const base = {
    requestKey: '00000000-0000-4000-8000-000000000001',
    items: [{ bookId: '1', quantity: 1 }],
  }
  expect(checkoutInputSchema.safeParse(base).success).toBe(false)
  expect(
    checkoutInputSchema.parse({
      ...base,
      deliveryAddress: address,
      expectedDeliveryFeeCents: 500,
      expectedTotalCents: 2500,
    }),
  ).toMatchObject({
    deliveryAddress: {
      recipientName: 'Buyer',
      addressLine1: '12 Main',
      addressLine2: null,
      countryCode: 'US',
    },
  })
})
