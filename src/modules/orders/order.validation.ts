import { z } from 'zod'

export const orderInputSchema = z.object({
  items: z
    .array(
      z.object({
        bookId: z.string().regex(/^\d+$/, 'Each quantity must be between 1 and 10'),
        quantity: z
          .number()
          .int('Each quantity must be between 1 and 10')
          .min(1, 'Each quantity must be between 1 and 10')
          .max(10, 'Each quantity must be between 1 and 10'),
      }),
    )
    .min(1, 'Order must contain 1 to 20 books')
    .max(20, 'Order must contain 1 to 20 books')
    .refine(
      (items) => new Set(items.map((item) => item.bookId)).size === items.length,
      'Each book can appear only once',
    ),
})

export const orderPageSchema = z.object({
  limit: z.number().int().min(1).max(50),
  offset: z.number().int().min(0),
})
