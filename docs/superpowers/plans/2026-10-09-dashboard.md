# Dashboard Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for native execution in this session. Steps use checkbox syntax for tracking.

**Goal:** Deliver the specified operational dashboard and Admin-only interactive payment reporting.

**Architecture:** Extend the existing permissioned GraphQL API with bounded database aggregates and previews. Keep shared metric/range rules in a dashboard module and dialect queries in the existing SQLite/PostgreSQL adapters. Render a lazy-loaded React dashboard with existing workspace primitives and Recharts.

**Tech Stack:** TypeScript, Express/Apollo, Drizzle, SQLite/PostgreSQL, React/Apollo Client, shadcn/ui, Recharts, Vitest, Playwright.

**Specs:** [Backend](../../../specs/dashboard/SPEC.md) and [frontend](../../../../frontend/specs/dashboard/SPEC.md).

## Global constraints

- Work in the existing backend and frontend feat/dashboard branches; preserve the user's documentation edits.
- Follow integration-first TDD, selective component tests and small critical E2E coverage; no mandatory helper-by-helper unit tests.
- Fixed proposed timezone Asia/Dubai; periods DAYS_7, DAYS_30, DAYS_90 include partial today.
- Finance is Admin-only; operational queries require VIEW_ORDERS and MANAGE_CATALOG.
- Financial sums are exact base-10 integer strings in cents; no lossy money arithmetic.
- No data reset, reporting table, payment/provider call, notification or unrelated refactor.
- Both providers must agree; test databases remain isolated. Node >=24 and Bun 1.3.14 remain the tooling baseline.
- Keep all acceptance boxes unchecked until evidence verifies them. Update root docs only after delivery.

## Review focus

- Created-at formats differ: equivalent timestamps must produce stable chronological ordering on both providers (Task 1 parity fixture).
- Refunds may precede the selected capture window: net can be negative without losing the original capture (Task 1 finance fixture).
- Large summed amounts may exceed GraphQL Int and safe plotting numbers: exact cards/tables survive chart fallback (Tasks 1 and 3).
- Responses may finish out of order: selected period and visible values must stay paired (Task 3 component test).
- A viewer can lose Admin while finance is loading: financial content and requests must stop without losing permitted Staff access (Tasks 2 and 4).

## Task 1: Database dashboard reads and shared metric rules

**Files:** Create src/modules/dashboard/dashboard.types.ts, dashboard.validation.ts, dashboard.service.ts and dashboard.repository.ts. Modify src/database/store.types.ts, src/database/sqlite/store.ts and src/database/postgresql/store.ts. Extend test/database-parity.test.ts; add test/dashboard.test.ts where API-specific cases belong.

**Interfaces:** Produce createDashboardRepository(input: DatabaseInput), with workspace() and finance(range) reads. Produce createDashboardService(repository, now: () => number = Date.now), with workspace() and finance(period: unknown). Return the DTOs defined in the paired backend spec. Extend DomainStore with typed dashboard read contracts; keep SQL out of services.

- [ ] Write failing real-database assertions: active stock at 0, 1, 5 and 6; archived exclusions; all four fulfillment buckets; unpaid/cancelled exclusions; list limit five and oldest/newest ties.
- [ ] Run bun run test -- test/database-parity.test.ts; verify the missing dashboard read behavior causes failure.
- [ ] Implement bounded adapter reads and shared DTO mapping. Use read snapshots; PostgreSQL reporting needs a consistent snapshot without changing transaction semantics for existing writes. Normalize createdAt ordering in adapters.
- [ ] Add and run failing finance fixtures with a fixed clock at a Dubai day boundary: 7/30/90 points, zero filling, boundary exclusion, cross-month/year dates, captured orders later refunded, refund-only negative net, duplicate retry evidence and amounts above 2147483647.
- [ ] Implement exact aggregation and range validation, including explicit null rejection. Keep sums exact through database extraction and serialization; detect count overflow.
- [ ] Run focused integration tests until green and bun run test:postgres for shared parity. Confirm read-only results and no unbounded application-side order loading.

## Task 2: Permissioned GraphQL API

**Files:** Create src/modules/dashboard/dashboard.schema.ts and dashboard.resolvers.ts. Modify src/modules/admin/admin.authorization.ts, src/graphql/schema.ts and src/graphql/resolvers.ts. Generate src/graphql/generated/resolvers.ts. Add API assertions to test/dashboard.test.ts.

**Interfaces:** Expose workspaceDashboard: WorkspaceDashboard! and adminDashboardFinance(period: DashboardPeriod = DAYS_30): DashboardFinance! exactly as specified. Add VIEW_DASHBOARD_FINANCE for ADMIN only. Resolver factory consumes Task 1 repository and existing role repository.

- [ ] Write real API failing tests: guest UNAUTHENTICATED, Customer FORBIDDEN, Staff operational success and finance FORBIDDEN, Admin finance success. Include aliases, mixed queries, invalid enum and null period.
- [ ] Run bun run test -- test/dashboard.test.ts and confirm missing schema behavior.
- [ ] Compose the new module and enforce guards before reporting reads. Summary DTOs contain only specified fields, never address/email/provider details.
- [ ] Run bun run codegen, focused API tests and bun run build. Verify existing clients remain compatible and role changes affect subsequent API calls.

## Task 3: Frontend dashboard and charts

**Files:** Create src/features/admin/pages/DashboardPage.tsx and focused dashboard components/helpers under src/features/admin/dashboard/. Add src/app/components/ui/chart.tsx. Modify src/operations.graphql, src/app/App.tsx, src/features/admin/AdminLayout.tsx, applicable default workspace links and src/features/auth/pages/AuthPage.tsx. Generate src/generated/graphql.ts; update package.json and bun.lock. Add selective dashboard component tests and formatting/race tests.

**Interfaces:** Consume Task 2 operations as generated documents. Render DashboardPage at /admin, lazy-loaded under existing workspace guards. Operational and Admin-only finance sections own separate query states. Reuse StockDialog by fetching its existing AdminBook fragment on demand rather than inventing missing book metadata.

- [ ] Write failing component assertions for Admin/Staff query gating, period URL normalization preserving other parameters, stale response rejection, exact monetary formatting and safe plot fallback.
- [ ] Run the new tests and confirm failures are missing dashboard behavior, not fixture errors.
- [ ] Verify compatible Recharts/shadcn chart APIs from official docs and install with Bun. Preserve workspace theme and supported accessibility behavior.
- [ ] Add GraphQL operations and run frontend codegen against the updated API. Implement cards, bounded lists, interactive captured-payment area/refund line, fulfillment bars and ordinary equivalent links. Keep action links and metric labels accurate where existing filters differ.
- [ ] Add date selector, independent loading/error/refresh/stale handling and exact daily table. Fetch on entry/focus/manual refresh, deduplicate requests, refetch finance only for period changes, and refetch operations after successful stock changes.
- [ ] Route /admin to the lazy dashboard and add exact-match navigation. Change only default workspace/demo-login destinations to /admin; preserve explicit returnTo destinations. Update affected existing tests for intentional destination changes.
- [ ] Run frontend focused tests, lint and build. Confirm public-route bundles do not eagerly import chart code and keyboard/reduced-motion/light-dark states are usable.

## Task 4: Connected journeys and delivery verification

**Files:** Add e2e/dashboard.spec.ts; update affected e2e/admin.spec.ts, demo-login tests and existing fixtures only as needed. Update both root SPEC.md/README and affected authentication/demo-login/workspace specs after checks. Reconcile both specs/dashboard/SPEC.md.

**Interfaces:** Use existing isolated browser server and disposable PostgreSQL runner. Reuse existing order-processing and stock APIs; no test-only dashboard endpoint or persisted development fixture reset.

- [ ] Write and run failing Playwright journeys for Admin entry, range change, accessible chart/table, drill-down/return, stock adjustment refresh, Staff restriction and guest/Customer denial.
- [ ] Add role-loss while finance is visible/loading and mobile/keyboard checks within coherent journeys; verify API denial independently in Task 2.
- [ ] Run both repositories' bun run test, bun run lint and bun run build. Run backend bun run test:postgres, frontend bun run test:e2e and backend bun run test:postgres:browser.
- [ ] Inspect desktop/mobile rendering, financial labels, exact tooltip/table values, focus behavior and public bundle separation. Resolve failures and report any limits rather than claiming unverified criteria.
- [ ] Perform whole-change review; reconcile documentation with the global spec-updater subagent, with exclusive documentation ownership. Review its diff and unresolved gaps.
- [ ] Mark dashboard specs Implemented only after acceptance criteria pass. Preserve existing testing policy. Leave a concrete reviewable diff on feat/dashboard; do not push, merge or deploy without an instruction.

## Completion evidence

The checklist above preserves the original execution instructions. Delivery is
complete; the paired dashboard specifications record verified acceptance, and
the delivery record below records the final checks. Selective asynchronous
frontend tests were added during review rather than all preceding implementation;
the post-write refresh regression was reproduced red before its fix. Backend
API/provider behavior and initial dashboard navigation were verified red/green.

## Delivery record (2026-10-09)

The delivered implementation kept the specified bounded, read-only dashboard
queries and additive GraphQL contract. It added no migration, reporting table,
provider call, environment variable, data reset, or background job.

Backend verification: 193 tests across 35 files, 22 disposable PostgreSQL parity
tests, generated resolver types, lint, and build passed. Frontend verification: 132
tests across 32 files, generated GraphQL types, lint, and build passed. The complete
38-journey browser suite passed against both the isolated SQLite API and a disposable
PostgreSQL cluster; its cleanup completed successfully. Four focused dashboard
journeys additionally covered the delivered dashboard behavior. Desktop light/dark
and mobile dark screenshots were inspected. The existing 922 kB main-bundle warning
remains; the lazy dashboard chart chunk is 382 kB.
