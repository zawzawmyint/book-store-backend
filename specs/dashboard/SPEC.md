# The Quiet Shelf API — dashboard

> **Status:** Implemented. **Date:** 2026-10-09.

## Goal and scope

Provide a read-only workspace overview of fulfillment, inventory, and recorded
test payments. Coordinate with [the frontend specification](../../../frontend/specs/dashboard/SPEC.md).
Reuse existing orders, books, permissions, and SQLite/PostgreSQL infrastructure.
No reporting tables, provider calls, background jobs, or payment mutations.

Include current fulfillment counts, bounded action lists, recent orders, active
stock alerts, and Admin-only daily captured-payment/refund summaries. Exclude radar
charts, genre analytics, forecasts, exports, comparisons to previous periods,
notifications, multi-currency reporting, profit, and live-payment enablement.

## GraphQL contract

The additive types below leave current order/book contracts unchanged. Operational
and financial queries are separate, so Staff clients do not request financial
aggregates.

```graphql
enum DashboardPeriod { DAYS_7 DAYS_30 DAYS_90 }
type DashboardStatusCount { status: OrderStatus!, count: Int! }
type DashboardOrderSummary {
  id: ID!
  customerName: String!
  createdAt: String!
  totalCents: Int!
  status: OrderStatus!
  payment: OrderPayment!
}
type DashboardStockBook { id: ID!, title: String!, stock: Int! }
type WorkspaceDashboard {
  generatedAt: String!
  fulfillment: [DashboardStatusCount!]!
  awaitingPreparation: [DashboardOrderSummary!]!
  readyToShip: [DashboardOrderSummary!]!
  recentOrders: [DashboardOrderSummary!]!
  lowStockCount: Int!
  outOfStockCount: Int!
  stockAlerts: [DashboardStockBook!]!
}
type DashboardPaymentDay {
  date: String!
  capturedCents: String!
  refundedCents: String!
  paidOrderCount: Int!
}
type DashboardFinance {
  generatedAt: String!
  period: DashboardPeriod!
  timeZone: String!
  startDate: String!
  endDate: String!
  currency: String!
  capturedCents: String!
  refundedCents: String!
  netCents: String!
  paidOrderCount: Int!
  days: [DashboardPaymentDay!]!
  failedRefundCount: Int!
  failedRefundOrders: [DashboardOrderSummary!]!
}
extend type Query {
  workspaceDashboard: WorkspaceDashboard!
  adminDashboardFinance(period: DashboardPeriod = DAYS_30): DashboardFinance!
}
```

Financial sums are base-10 integer strings in cents, avoiding GraphQL Int's 32-bit
limit. Use exact integer arithmetic, including negative net values; never accumulate
floating-point dollars or silently round an unsafe database result. Count fields
remain Int: overflow must produce a controlled error, never wrap or truncate.
Dates are YYYY-MM-DD; generatedAt is an ISO UTC instant. No arbitrary date range,
timezone argument, caller-supplied role, or configurable list limit in this slice.

## Authorization and validation

- workspaceDashboard requires both existing VIEW_ORDERS and MANAGE_CATALOG
  permissions, resolved from the current server session and stored role.
- `VIEW_DASHBOARD_FINANCE` is granted only to ADMIN. The
  `adminDashboardFinance` resolver enforces it before its reporting read.
- Guests receive UNAUTHENTICATED; Customers and Staff requesting finance receive
  FORBIDDEN. Aliases and combined queries cannot bypass the guards. No new HTTP route.
- Explicit null period is BAD_USER_INPUT; omission defaults to DAYS_30. Unknown
  enum values are rejected by GraphQL validation. Preserve existing error mapping.
- Do not expose email, delivery address, provider IDs, payment-operation errors,
  or user-directory details in dashboard summaries. Existing permissioned detail
  routes remain the source for processing and refund retries.

## Metric definitions

**Current operations (not filtered by the financial period):**

- Return exactly SUBMITTED, PREPARING, SHIPPED, DELIVERED, in that order, including
  zero counts. Count only orders with paymentStatus PAID and no cancellationIntent.
  Cancelled, expired, pending-payment and refund-state orders do not count.
- awaitingPreparation is up to five matching SUBMITTED orders; readyToShip is
  up to five matching PREPARING orders. Oldest first by createdAt then numeric ID.
- recentOrders is five saved orders of any state, newest first by createdAt then
  numeric ID descending. These rows are not implied to be paid.
- Stock counts exclude archived books. lowStockCount means stock 1–5 inclusive;
  outOfStockCount means zero. stockAlerts contains up to five active books with
  stock 0–5, ordered by stock then ID ascending. Never sum the two counts twice.
- failedRefundCount and failedRefundOrders are current REFUND_FAILED orders,
  independent of the selected period. Return five oldest first by createdAt then ID.

**Financial period:**

- The store reporting timezone is fixed to Asia/Dubai (UTC+04:00, with no daylight
  saving time) for this slice and is returned to the client.
- DAYS_7/30/90 includes today and the preceding 6/29/89 calendar days in that
  timezone. Use inclusive start-of-first-day and exclusive start-of-tomorrow
  boundaries; capture the clock once per response. Today's bucket is partial.
- capturedCents sums saved totalCents for orders whose non-null paidAt falls in
  the range, including orders subsequently cancelled/refunded. paidOrderCount
  counts those orders once. No paidAt means no inferred captured payment.
- refundedCents sums saved totalCents for orders whose non-null refundedAt falls
  in the range. The current workflow supports only full fee-inclusive refunds.
  Pending/failed attempts without refundedAt contribute zero. Never count retries
  or duplicate provider events as additional money.
- netCents = capturedCents minus refundedCents. A refund can appear in a different
  period from its capture and make net negative. Totals include delivery fees and
  do not claim profit, tax accounting, Stripe settlement, or deducted provider fees.
- paidAt/refundedAt currently record local verification/success processing time;
  charts use those stored timestamps, not a newly claimed provider occurrence time.
- Return exactly 7/30/90 ascending daily points, zero-filling missing days. Daily
  sums must equal headline sums. Currency is usd, matching existing constraints.
- Empty data yields zero summaries and empty lists, not errors. Use normalized
  handling of existing createdAt formats for deterministic ordering on both providers.

## Architecture and persistence

`src/modules/dashboard/` contains the schema, resolvers, validation, service,
repository, and DTO types. It is composed through `src/graphql/schema.ts` and
`src/graphql/resolvers.ts`; generated resolver types were regenerated. Shared SQL
for the provider adapters is in `src/database/dashboard.queries.ts`; focused typed
reads are exposed through `src/database/store.types.ts`,
`src/database/sqlite/store.ts`, and `src/database/postgresql/store.ts`.

Aggregate and limit in the database; do not load all orders or order items into
Node.js. Query count must be bounded independently of record count. Avoid joins
that multiply order totals. Use an internally consistent read snapshot for each
query; operational and finance queries may have different generatedAt instants.
Do not hold transactions across network calls. No runtime dependency or new env
variable is required in the API. No table/data migration or data reset is expected.
If profiling warrants indexes, propose and generate additive migrations for both
providers; preserve existing records and review query plans before introducing them.

## Acceptance criteria

- [x] Permissions are enforced before reads; guest/Customer requests and Staff
  finance requests are rejected, including aliases and mixed selections.
- [x] Current fulfillment, bounded lists, archive exclusions, stock thresholds,
  and deterministic ordering match the definitions above.
- [x] All periods have correct timezone boundaries, exact zero-filled points and
  daily/headline agreement, including partial today and month/year transitions.
- [x] Refunded captures remain captured; refunds use their own recorded date;
  retries do not multiply totals, and negative net values are valid.
- [x] Large summed amounts exceed 32-bit safely and are serialized exactly;
  explicit null/invalid periods do not perform reporting reads.
- [x] SQLite and PostgreSQL fixtures produce equivalent results, including empty
  data, timestamp boundaries, different capture/refund periods, and current alerts.
- [x] Reads are bounded and read-only; no provider call, inventory/payment change,
  sensitive summary field, or whole-order scan into application memory occurs.
- [x] Resolver codegen, relevant tests, test/lint/build and PostgreSQL checks pass.

## Validation and delivery

Integration-first tests covered roles and guard ordering, aliases/mixed requests,
invalid periods, operational thresholds and ordering, fixed-clock Dubai boundaries,
zero-filled periods, separate capture/refund dates, retries, exact sums beyond
32-bit, and read-only results. Shared SQLite/PostgreSQL fixtures covered provider
parity using disposable targets. The frontend owns connected browser coverage;
its isolated SQLite and disposable PostgreSQL browser suites each passed all 38
journeys, including the four dashboard journeys.

Verification completed with 193 backend tests across 35 files, 22 PostgreSQL
parity tests, generated resolver types, lint, and build. No migration, provider
call, environment variable, reset, reporting table, or background job was added.

Existing clients remain compatible. Deploy the additive API before the frontend. Roll back the dashboard frontend first,
then remove the additive API if required; no data rollback is expected.
