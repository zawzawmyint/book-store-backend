import { deliveryAddressSchema } from '../orders/delivery.validation.js'
import { z } from 'zod'
import { numericIdSchema } from '../../shared/validation.js'
import { orderInputSchema } from '../orders/order.validation.js'
export const checkoutInputSchema = orderInputSchema
  .extend({
    requestKey: z.uuid(),
    deliveryAddress: deliveryAddressSchema,
    expectedDeliveryFeeCents: z.number().int().min(0).max(2147483647),
    expectedTotalCents: z.number().int().min(50).max(2147483647),
  })
  .superRefine((input, ctx) => {
    for (const line of input.items)
      if (!numericIdSchema.safeParse(line.bookId).success)
        ctx.addIssue({ code: 'custom', message: 'Invalid book ID' })
  })
