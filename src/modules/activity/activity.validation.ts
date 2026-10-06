import { z } from 'zod'
import { activityActions, activityFields } from './activity.types.js'

const utc = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$/)
  .pipe(z.iso.datetime({ offset: true }))
const fraction = (value: string) => value.match(/\.(\d+)/)?.[1] ?? ''
function before(from: string, to: string) {
  const fromSecond = from.slice(0, 19)
  const toSecond = to.slice(0, 19)
  if (fromSecond !== toSecond) return fromSecond < toSecond
  const fromFraction = fraction(from),
    toFraction = fraction(to)
  const length = Math.max(fromFraction.length, toFraction.length)
  return fromFraction.padEnd(length, '0') < toFraction.padEnd(length, '0')
}
function millisecondBound(value: string | undefined) {
  if (!value) return undefined
  // Events have millisecond precision. Rounding either bound upward preserves
  // inclusive-from/exclusive-to comparisons for finer RFC3339 instants.
  const extraMillisecond = /[1-9]/.test(fraction(value).slice(3)) ? 1 : 0
  return new Date(Date.parse(value) + extraMillisecond).toISOString()
}
const id = z.string().trim().min(1)
export const activityInputSchema = z
  .object({
    actorUserId: id.optional(),
    action: z.enum(activityActions).optional(),
    changedField: z.enum(activityFields).optional(),
    targetType: z.enum(['BOOK', 'USER']).optional(),
    targetId: id.optional(),
    from: utc.optional(),
    to: utc.optional(),
    limit: z.number().int().min(1).max(50).default(20),
    offset: z.number().int().min(0).default(0),
  })
  .refine((value) => !value.targetId || !!value.targetType, 'targetId requires targetType')
  .refine(
    (value) => !value.from || !value.to || before(value.from, value.to),
    'from must precede to',
  )
  .transform((value) => ({
    ...value,
    from: millisecondBound(value.from),
    to: millisecondBound(value.to),
  }))
