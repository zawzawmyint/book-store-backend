# Workspace search — API specification

> **Status:** Implemented. **Date:** 2026-10-09.

## Goal

Let authenticated Staff and Admin find books and saved orders from a single workspace dialog. It reuses existing domain queries and permissions and adds order search without changing existing callers. See the [frontend specification](../../../frontend/specs/workspace-search/SPEC.md).

## Scope

- First version: Books and Orders only. Book search matches title, author and genre; order search matches an exact order number or saved customer name/email.
- Add an optional `search` argument to `adminOrders`. Keep the existing status filter, paging, result type and default behavior.
- No user-account search, storefront changes, external search service, full-text index, fuzzy ranking, mutations, provider calls, schema migrations or database resets.

## Existing architecture

- `adminBooks` already supports escaped case-insensitive substring search, archive filters and pagination. The workspace dialog uses `filter: ACTIVE`, `lowStockOnly: false`, `limit: 5`, `offset: 0`; archived books remain discoverable through the existing catalog filters.
- `adminOrders` supports status, pagination, and the additive text search. Its resolver, service and repository live in `src/modules/orders/admin-order.*`; `adminOrderPageSchema` lives in `order.validation.ts`.
- `DomainStore.orderPage` is shared by customer and workspace order lists. Preserve user scoping and the behavior of customer callers when extending it.
- Both adapters use `query.helpers.ts` for portable escaped text search. Reuse that helper for customer name/email.

## GraphQL contract

```graphql
adminOrders(
  limit: Int = 20
  offset: Int = 0
  status: OrderStatusFilter = ALL
  search: String
): AdminOrdersPage!
```

This is additive. Missing, null, empty or whitespace-only search retains the existing list behavior. `items` and `total` must use the same combined search/status predicate, before limit/offset. Preserve the existing newest-first ordering and add an ID tie-breaker if needed for deterministic paging.

The frontend uses separate bounded Books and Orders operations with minimal selections, so an ordinary failure in one group does not discard successful results in the other. Existing `AdminOrders` adds a search variable for the full-list drill-down. No new aggregate endpoint or GraphQL result type is required.

## Matching and validation

- Trim input; reject more than 100 characters after trimming with `BAD_USER_INPUT`. Preserve `limit: 1..50`, nonnegative offset and the existing status enum validation.
- A trimmed all-digit term such as `42`, or `#` followed by digits such as `#42`, matches only that exact order ID. Leading zeros are accepted. An ID outside the positive signed-32-bit range (`1..2147483647`) returns no matches; it must not overflow or fall back to customer search.
- Other nonempty terms match case-insensitive literal substrings of the order's saved `customerName` or `email`. Use the order snapshot, not a join to the current account name.
- `%`, `_`, backslashes and quotes are literal text, using parameterized SQL and the existing escaping helper. No raw string interpolation into SQL.
- Search combines with status using AND. All payment states and fulfillment states remain eligible unless the caller supplies a status filter; search does not imply paid-only orders.
- The UI starts requests at two trimmed characters, with a one-digit exact-ID exception. The API does not impose that UI threshold: one-character and empty searches remain valid for list compatibility.

## Authorization and data handling

- Keep `MANAGE_CATALOG` for book queries and `VIEW_ORDERS` for order queries; resolve current server role through existing guards on every request.
- Guests receive `UNAUTHENTICATED`; Customers receive `FORBIDDEN`. Staff and Admin have identical Books/Orders search access. No user-directory or financial-aggregate permission is added.
- Search selects only book identity/title/author/stock and order identity/customer/status/date needed by the UI. Do not add delivery addresses, phone numbers, history or financial totals to the search operations.
- Do not log raw search terms or customer email addresses. No persisted search history or provider integration is introduced.

## Files affected during implementation

- `src/modules/orders/order.schema.ts`, `order.validation.ts`, and `admin-order.resolvers.ts`, `admin-order.service.ts`, `admin-order.repository.ts`.
- `src/database/store.types.ts`, `src/database/sqlite/store.ts`, `src/database/postgresql/store.ts`; extend the shared store boundary compatibly without changing customer scoping.
- `src/database/query.helpers.ts` for portable order search, `src/database/connection.ts`
  for the scoped SQLite Unicode-lower function, and `scripts/test-postgresql.ts` for
  UTF-8 disposable-cluster initialization.
- `src/graphql/generated/resolvers.ts` through `bun run codegen` only.
- Existing `test/admin-orders.test.ts` and `test/database-parity.test.ts`, plus root documentation as required.

## Acceptance criteria

- [x] Existing calls without search return the same records, totals, order and pagination.
- [x] Exact IDs, customer names/emails, whitespace, case, literal wildcard characters and no matches behave as defined.
- [x] Search and status filtering agree between totals and paginated records, with deterministic ordering.
- [x] Guest/Customer rejection and Staff/Admin access are enforced by the API; customer order lists remain owner-scoped.
- [x] SQLite and PostgreSQL return equivalent results, including out-of-range numeric terms.
- [x] Matching frontend operations and connected search/drill-down journeys pass on
  both isolated SQLite and disposable PostgreSQL browser fixtures.

## Validation and delivery

Integration/API and provider-parity tests cover the optional argument, trim/100-character
limit, signed-32-bit exact-ID bounds, saved-name/email matching, literal wildcards,
status/pagination composition, authorization, and customer owner scoping. SQLite uses
a scoped Unicode-aware `unicode_lower` function for saved customer data; PostgreSQL
uses its provider expression. The disposable PostgreSQL fixture explicitly initializes
UTF-8 so a Windows inherited WIN1252 locale cannot change parity behavior.

Verified checks: 196 backend tests across 35 files, 24 PostgreSQL parity tests,
code generation, lint, and build. The full 43-journey browser suite passed against
both isolated SQLite and disposable PostgreSQL fixtures; the PostgreSQL runner exited
cleanly after awaiting cluster shutdown. No production configuration, migration,
reset, or dependency changed.

Deploy the additive API before the frontend. Rolling back the frontend restores
existing page filters; the unused optional API argument is safe to retain.
