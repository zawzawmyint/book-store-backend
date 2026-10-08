import { z } from 'zod'

// eslint-disable-next-line no-control-regex -- reject embedded control characters in private delivery text
const noControls = (value: string) => !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
const required = (max: number) =>
  z
    .string()
    .refine(noControls, 'Control characters are forbidden')
    .transform((v) => v.trim())
    .pipe(z.string().min(1).max(max))
const optional = (max: number) =>
  z
    .string()
    .refine(noControls, 'Control characters are forbidden')
    .transform((v) => v.trim() || null)
    .pipe(z.string().max(max).nullable())
    .nullish()
    .transform((v) => v ?? null)
export const deliveryAddressSchema = z.object({
  recipientName: required(120),
  phone: required(32).refine(
    (v) => /^[\d +()-]{7,32}$/.test(v) && v.replace(/\D/g, '').length >= 7,
    'Enter a valid phone number',
  ),
  addressLine1: required(200),
  addressLine2: optional(200),
  city: required(100),
  region: optional(100),
  postalCode: optional(32),
  countryCode: required(2)
    .transform((v) => v.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{2}$/)),
})
export const shipmentSchema = z
  .object({ carrier: required(100), trackingNumber: optional(120), trackingUrl: optional(2048) })
  .superRefine((v, ctx) => {
    if (!v.trackingUrl) return
    let safe = false
    try {
      const url = new URL(v.trackingUrl)
      safe = url.protocol === 'https:' && !!url.hostname && !url.username && !url.password
    } catch {
      /* invalid URL */
    }
    if (!v.trackingNumber || !safe)
      ctx.addIssue({
        code: 'custom',
        message: 'Tracking URL requires a tracking number and a safe HTTPS URL',
        path: ['trackingUrl'],
      })
  })
export type DeliveryAddress = z.infer<typeof deliveryAddressSchema>
export type Shipment = z.infer<typeof shipmentSchema>
export type DeliveryConfig = {
  deliveryEnabled?: boolean
  deliveryCountryCodes?: string[]
  deliveryFeeCents?: number
}
export type OrderDelivery = {
  address: DeliveryAddress
  shipment: Shipment | null
  shippedAt: string | null
  deliveredAt: string | null
}
