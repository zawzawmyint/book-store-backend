import { z } from 'zod'
import { ValidationError } from './errors.js'

// Public lookups retain digit-only compatibility, including leading zeroes.
export const numericLookupIdSchema = z.string().regex(/^\d+$/)
export const numericIdSchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .refine((id) => Number.isSafeInteger(Number(id)))
export function validated<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new ValidationError(result.error.issues[0].message)
  return result.data
}
