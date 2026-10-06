import { z } from 'zod'

export const activityActions = [
  'BOOK_CREATED',
  'BOOK_UPDATED',
  'BOOK_STOCK_ADJUSTED',
  'BOOK_ARCHIVED',
  'BOOK_RESTORED',
  'USER_ROLE_CHANGED',
  'USER_PASSWORD_RESET',
] as const
export const activityFields = [
  'TITLE',
  'AUTHOR',
  'GENRE',
  'DESCRIPTION',
  'PRICE_CENTS',
  'STOCK',
  'ARCHIVED',
  'ROLE',
] as const
export const activityChangeSchema = z
  .object({
    field: z.enum(activityFields),
    before: z.string().nullable(),
    after: z.string().nullable(),
  })
  .strict()
export type ActivityChange = z.infer<typeof activityChangeSchema>
export type ActivityActor =
  | { source: 'GRAPHQL'; userId: string; name: string; role: 'CUSTOMER' | 'STAFF' | 'ADMIN' }
  | { source: 'OPERATOR'; userId: null; name: 'Operator command'; role: null }
export const operatorActor: ActivityActor = {
  source: 'OPERATOR',
  userId: null,
  name: 'Operator command',
  role: null,
}
