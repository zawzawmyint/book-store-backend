import { z } from 'zod'
import { numericIdSchema } from '../../shared/validation.js'
import { orderInputSchema } from '../orders/order.validation.js'

export const cartRevisionSchema = z
  .string()
  .max(100)
  .regex(/^(0|[1-9]\d*)$/)
const operation = { expectedRevision: cartRevisionSchema, requestKey: z.uuid() }
export const setCartItemSchema = z.object({
  ...operation,
  bookId: numericIdSchema,
  quantity: z.number().int().min(0).max(10),
})
export const mergeGuestCartSchema = orderInputSchema.extend(operation)
