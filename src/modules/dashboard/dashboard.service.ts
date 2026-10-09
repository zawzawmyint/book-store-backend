import { validated } from '../../shared/validation.js'
import type { createDashboardRepository } from './dashboard.repository.js'
import { dashboardPeriodSchema } from './dashboard.validation.js'

const DAY = 86400000
const DUBAI_OFFSET = 4 * 3600000
const date = (instant: number) => new Date(instant).toISOString().slice(0, 10)

export function createDashboardService(
  repository: ReturnType<typeof createDashboardRepository>,
  now: () => number = Date.now,
) {
  return {
    async workspace() {
      const generatedAt = new Date(now()).toISOString()
      return { generatedAt, ...(await repository.workspace()) }
    },
    async finance(input: unknown = 'DAYS_30') {
      const period = validated(dashboardPeriodSchema, input)
      const days = period === 'DAYS_7' ? 7 : period === 'DAYS_30' ? 30 : 90
      const instant = now()
      // Asia/Dubai is UTC+04:00 without daylight saving time.
      const today = Math.floor((instant + DUBAI_OFFSET) / DAY) * DAY
      const first = today - (days - 1) * DAY
      const range = {
        start: new Date(first - DUBAI_OFFSET).toISOString(),
        end: new Date(today + DAY - DUBAI_OFFSET).toISOString(),
        startDate: date(first),
        endDate: date(today),
        dates: Array.from({ length: days }, (_, index) => date(first + index * DAY)),
      }
      const result = await repository.finance(range)
      const captured = result.days.reduce((sum, day) => sum + BigInt(day.capturedCents), 0n)
      const refunded = result.days.reduce((sum, day) => sum + BigInt(day.refundedCents), 0n)
      const paidOrderCount = result.days.reduce((sum, day) => sum + day.paidOrderCount, 0)
      if (paidOrderCount > 2147483647) throw new Error('Dashboard count exceeds supported range')
      return {
        ...result,
        period,
        generatedAt: new Date(instant).toISOString(),
        timeZone: 'Asia/Dubai',
        startDate: range.startDate,
        endDate: range.endDate,
        currency: 'usd',
        capturedCents: String(captured),
        refundedCents: String(refunded),
        netCents: String(captured - refunded),
        paidOrderCount,
      }
    },
  }
}

export type WorkspaceDashboardResult = Awaited<
  ReturnType<ReturnType<typeof createDashboardService>['workspace']>
>
export type DashboardFinanceResult = Awaited<
  ReturnType<ReturnType<typeof createDashboardService>['finance']>
>
