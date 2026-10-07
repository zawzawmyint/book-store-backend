import { z } from 'zod'
import { numericIdSchema } from '../../shared/validation.js'
import { orderInputSchema } from '../orders/order.validation.js'
export const checkoutInputSchema = orderInputSchema
  .extend({ requestKey: z.uuid() })
  .superRefine((input, ctx) => {
    for (const line of input.items)
      if (!numericIdSchema.safeParse(line.bookId).success)
        ctx.addIssue({ code: 'custom', message: 'Invalid book ID' })
  })
