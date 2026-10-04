import { z } from 'zod'

export const adminCustomersInputSchema = z.object({
  search: z.string().trim().max(100),
  role: z.enum(['ALL', 'CUSTOMER', 'ADMIN']),
  limit: z.number().int().min(1).max(50),
  offset: z.number().int().min(0),
})

export const customerUserIdSchema = z.string().trim().min(1, 'User was not found')

export const customerPasswordSchema = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(128, 'Use at most 128 characters.')
