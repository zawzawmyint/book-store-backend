import { sql, type SQL } from 'drizzle-orm'
import type {
  DashboardRange,
  DashboardOrderSummary,
  WorkspaceDashboardData,
  DashboardFinanceData,
} from '../modules/dashboard/dashboard.types.js'

export type DashboardQuery = <T>(query: SQL) => Promise<T[]>
type SummaryRow = Omit<DashboardOrderSummary, 'id' | 'payment'> & {
  id: number
  paymentStatus: DashboardOrderSummary['payment']['status']
  paymentRequired: boolean | number
  cancellationIntent: string | null
  currency: string
  expiresAt: string | null
  paidAt: string | null
  refundedAt: string | null
}
const summaryColumns = sql`id, customer_name AS "customerName", created_at AS "createdAt",
  total_cents AS "totalCents", status, payment_status AS "paymentStatus",
  payment_required AS "paymentRequired", cancellation_intent AS "cancellationIntent",
  currency, expires_at AS "expiresAt", paid_at AS "paidAt", refunded_at AS "refundedAt"`
const countText = sql`CAST(COUNT(*) AS TEXT)`
const paid = sql`payment_status = 'PAID' AND cancellation_intent IS NULL`
const statuses = ['SUBMITTED', 'PREPARING', 'SHIPPED', 'DELIVERED'] as const

function count(value: string) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0 || number > 2147483647)
    throw new Error('Dashboard count exceeds supported range')
  return number
}
function summary(row: SummaryRow): DashboardOrderSummary {
  return {
    id: String(row.id),
    customerName: row.customerName,
    createdAt: row.createdAt,
    totalCents: row.totalCents,
    status: row.status,
    payment: {
      required: Boolean(row.paymentRequired),
      cancellationPending: row.cancellationIntent !== null,
      status: row.paymentStatus,
      currency: row.currency,
      expiresAt: row.expiresAt,
      paidAt: row.paidAt,
      refundedAt: row.refundedAt,
    },
  }
}

// All dialect SQL remains in the database layer. These reads execute inside a
// single connection snapshot; only aggregates and five-row previews leave it.
export function createDashboardQueries(query: DashboardQuery, provider: 'sqlite' | 'postgresql') {
  const active = provider === 'sqlite' ? sql`archived = 0` : sql`archived = false`
  const created =
    provider === 'sqlite'
      ? sql`julianday(created_at)`
      : sql`(CASE WHEN created_at LIKE '%T%' THEN created_at::timestamptz ELSE (created_at::timestamp AT TIME ZONE 'UTC') END)`
  const orders = async (where: SQL, newest = false) => {
    const direction = newest ? sql`DESC` : sql`ASC`
    return (
      await query<SummaryRow>(sql`SELECT ${summaryColumns} FROM orders WHERE ${where}
      ORDER BY ${created} ${direction}, id ${direction} LIMIT 5`)
    ).map(summary)
  }
  return {
    async workspace(): Promise<WorkspaceDashboardData> {
      const grouped = await query<{ status: string; n: string }>(
        sql`SELECT status, ${countText} AS n FROM orders WHERE ${paid} GROUP BY status`,
      )
      const stocks = await query<{ low: string; empty: string }>(sql`SELECT
        CAST(COALESCE(SUM(CASE WHEN stock BETWEEN 1 AND 5 THEN 1 ELSE 0 END),0) AS TEXT) AS low,
        CAST(COALESCE(SUM(CASE WHEN stock = 0 THEN 1 ELSE 0 END),0) AS TEXT) AS empty
        FROM books WHERE ${active}`)
      const stockAlerts = await query<{ id: number; title: string; stock: number }>(
        sql`SELECT id,title,stock FROM books WHERE ${active} AND stock <= 5 ORDER BY stock,id LIMIT 5`,
      )
      return {
        fulfillment: statuses.map((status) => ({
          status,
          count: count(grouped.find((row) => row.status === status)?.n ?? '0'),
        })),
        awaitingPreparation: await orders(sql`${paid} AND status = 'SUBMITTED'`),
        readyToShip: await orders(sql`${paid} AND status = 'PREPARING'`),
        recentOrders: await orders(sql`1=1`, true),
        lowStockCount: count(stocks[0].low),
        outOfStockCount: count(stocks[0].empty),
        stockAlerts: stockAlerts.map((row) => ({ ...row, id: String(row.id) })),
      }
    },
    async finance(range: DashboardRange): Promise<DashboardFinanceData> {
      async function totals(column: 'paid_at' | 'refunded_at') {
        const field = sql.identifier(column)
        const day =
          provider === 'sqlite'
            ? sql`date(${field}, '+4 hours')`
            : sql`to_char(${field}::timestamptz AT TIME ZONE 'Asia/Dubai', 'YYYY-MM-DD')`
        const within =
          provider === 'sqlite'
            ? sql`julianday(${field}) >= julianday(${range.start}) AND julianday(${field}) < julianday(${range.end})`
            : sql`${field}::timestamptz >= ${range.start}::timestamptz AND ${field}::timestamptz < ${range.end}::timestamptz`
        return query<{ date: string; cents: string; n: string }>(sql`SELECT ${day} AS date,
          CAST(SUM(total_cents) AS TEXT) AS cents, ${countText} AS n
          FROM orders WHERE ${field} IS NOT NULL AND ${within} GROUP BY ${day}`)
      }
      const captures = await totals('paid_at')
      const refunds = await totals('refunded_at')
      const failed = await query<{ n: string }>(
        sql`SELECT ${countText} AS n FROM orders WHERE payment_status = 'REFUND_FAILED'`,
      )
      return {
        days: range.dates.map((date) => ({
          date,
          capturedCents: captures.find((row) => row.date === date)?.cents ?? '0',
          refundedCents: refunds.find((row) => row.date === date)?.cents ?? '0',
          paidOrderCount: count(captures.find((row) => row.date === date)?.n ?? '0'),
        })),
        failedRefundCount: count(failed[0].n),
        failedRefundOrders: await orders(sql`payment_status = 'REFUND_FAILED'`),
      }
    },
  }
}
