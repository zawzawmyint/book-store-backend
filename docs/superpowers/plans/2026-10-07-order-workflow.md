# Order Workflow Implementation Plan

> Execute the paired accepted specifications using subagent-driven development.

**Goal:** Implement Submitted/Accepted/Completed/Cancelled requests with accurate
inventory, customer details, workspace actions, and audited history.

**Architecture:** Existing order services/repositories own transactional writes;
GraphQL exposes owner-scoped and permission-guarded reads/actions. React uses
generated documents with confirmed server state and existing session boundaries.

**Specs:** [Backend](../../../specs/order-workflow/SPEC.md) and
[frontend](../../../../frontend/specs/order-workflow/SPEC.md).

**Constraints:** No payments, shipping, notifications, reopening, bulk actions,
new dependencies, or production data reset. Local data reset is authorized.
Cancel reason is trimmed 1–500 characters. Customer history excludes staff details.

## Task 1: Backend workflow (backend worker)

- [x] Write failing API/service tests for placement status/history, owner isolation,
      allowed transitions, no-ops, stale conflicts, cancellation validation,
      archived/duplicate-line restoration, role attribution, rollback, concurrency.
- [x] Run tests to confirm failures for missing behavior.
- [x] Extend order schema/types/validation/repositories/services/resolvers with
      `myOrder(id)`, filtered `adminOrders`, and `setOrderStatus(input)` returning
      AdminOrder per the spec. Add PROCESS_ORDERS, timeline storage and Activity enums.
- [x] Generate migration/types and prohibit silently upgrading populated old orders.
- [x] Run backend tests, lint, build, and review the implementation.

## Task 2: Frontend workflow (frontend worker)

- [x] Write failing component tests for status controls, reason validation,
      conflict/refetch handling, uncertain outcomes, filter URLs, and customer privacy.
- [x] Extend operations and generate documents once the backend schema is ready.
- [x] Implement customer detail, receipt/list links, status badges/timeline,
      workspace filtering/actions/dialogs, and Activity order links/labels.
- [x] Preserve session guards, cache clearing, draft input, terminal action absence,
      role-specific permissions, mobile and keyboard behavior.
- [x] Run frontend tests/lint/build and review the implementation.

## Task 3: Integrated browser coverage and local setup (primary agent)

- [x] Update isolated e2e fixtures to consistent workflow orders/history/inventory.
- [x] Add browser journeys for Customer→Staff→Admin, completion, cancellation,
      archived restoration, repeated action, snapshots, privacy and filters.
- [x] Run full browser suite and resolve regressions with owning workers.
- [x] Stop the local API, verify the configured SQLite path, reset only its database
      and SQLite sidecars, migrate, seed catalog/demo users, restart API.
- [x] Clear browser stale sessions/cart through the explicit local setup procedure;
      do not introduce automatic normal-startup or sign-out cart wipes.

## Task 4: Final review and documentation

- [x] Request independent code review; fix actionable findings and rerun affected tests.
- [x] Delegate final documentation reconciliation to spec-updater after checks settle.
- [x] Review documentation diff/links and mark Implemented only for verified criteria.
- [x] Report delivered behavior, checks, branch state and remaining limitations.

## Review focus

- Cancellation retries and parallel attempts must not repeat inventory restoration.
- Failed Activity/timeline/inventory writes must roll back the status change.
- Owner detail and schema selection must never expose staff attribution to customers.
- Unknown outcomes/conflicts must refresh actual state without automatic mutation replay.
- Fresh-only setup must never destructively reset data at normal startup or in production.
