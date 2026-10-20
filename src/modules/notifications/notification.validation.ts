import { z } from 'zod'
export const notificationScopeSchema = z.enum(['STOREFRONT', 'WORKSPACE'])
const cursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() }).strict()
export const notificationPageSchema = z.object({
  first: z.number().int().min(1).max(50).default(20),
  after: z.string().max(512).nullish(),
  unreadOnly: z.boolean().default(false),
})
export function decodeNotificationCursor(value?: string | null) {
  if (!value) return undefined
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')))
  } catch {
    throw new Error('Invalid notification cursor')
  }
}
