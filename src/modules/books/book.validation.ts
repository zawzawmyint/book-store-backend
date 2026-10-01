import { z } from 'zod'
import { numericIdSchema } from '../../shared/validation.js'

export const catalogInputSchema = z.object({
  search: z.string().trim().max(100),
  limit: z.number().int().min(1).max(24),
  offset: z.number().int().min(0),
})

export const adminBookIdSchema = numericIdSchema
export const bookDetailsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  author: z.string().trim().min(1).max(200),
  genre: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(5000),
  priceCents: z.number().int().min(0).max(1000000),
})
export const stockSchema = z.number().int().min(0).max(1000000)
export const stockDeltaSchema = z
  .number()
  .int()
  .min(-1000000)
  .max(1000000)
  .refine((n) => n !== 0, 'Stock change must not be zero')
export const adminBooksInputSchema = z.object({
  search: z.string().trim().max(100),
  filter: z.enum(['ACTIVE', 'ARCHIVED', 'ALL']),
  lowStockOnly: z.boolean(),
  limit: z.number().int().min(1).max(50),
  offset: z.number().int().min(0),
})
