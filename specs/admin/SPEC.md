# The Quiet Shelf API — admin panel specification

> **Status:** Implemented. **Date:** 2026-10-01.

## Goal and agreed scope

Let store administrators manage books and inventory and view all order requests through the existing GraphQL API. Deliver the full feature in phases: access control, catalog and inventory management, then order viewing. The matching user experience is defined in [the frontend spec](../../../frontend/specs/admin/SPEC.md).

The user selected this phased scope, including order viewing. The contracts and limits below are delivered design decisions for review.

## Current system and boundaries

- Express, Apollo, Drizzle, SQLite, and module-local Zod validation already serve a separate React storefront. Better Auth supplies account identity through server sessions.
- Public catalog queries are `books`, `book`, and `genres`. `placeOrder` checks stock and saves orders and stock deductions in one transaction. `myOrders` restricts history to the session user.
- There is no admin authorization, book write API, archive flag, or order administration. Order items reference books and preserve title and price snapshots.
- Use the existing `/graphql` endpoint and `/api/auth/*` login flow. No second auth server or admin application is required.
- Exclude public role assignment, customer account administration, book deletion, image uploads, dashboards, audit-log UI, bulk import, order status changes, cancellation, automatic restocking, payment, shipping, and email notifications.

## Phase 1 — administrator access

- Introduce a server-owned `admin_memberships` table with `user_id` as its primary key and a foreign key to the Better Auth user table with cascade deletion. Presence means admin access; absence means customer access. All existing and newly registered users start without membership.
- Do not alter generated Better Auth tables or accept a role or membership from sign-up, account updates, cookies, headers, or GraphQL arguments.
- Add `viewer: Viewer` to `Query`, where `Viewer` contains `id: ID!` and `role: UserRole!`; `UserRole` has `CUSTOMER` and `ADMIN`. Return null for a missing or expired session. Resolve role from membership in SQLite, not client state.
- Every admin operation requires a valid server session and a current membership lookup before accessing private data or writing. Check authorization before domain validation or record lookup. Missing/expired sessions return `UNAUTHENTICATED`; authenticated customers return `FORBIDDEN`, without exposing record existence.
- Do not cache membership in a long-lived session or token. Revoking membership takes effect on the next request. A write already authorized before revocation may finish.
- Provide the operator command `bun run admin:access -- grant <user-id>` and `bun run admin:access -- revoke <user-id>`. It uses configured `DATABASE_PATH` and the normal migration wrapper, requires an existing exact user ID, changes membership only, and never creates an account or password. Grant and revoke are idempotent; unknown users or malformed arguments exit nonzero. Report only action and user ID, never credentials.
- Operators sign up the intended account normally, verify its identity, and grant it explicitly using its database user ID. No first-signup promotion, email allowlist, seeded administrator, public promotion endpoint, or persisted bootstrap secret. Additional admins use the same command. Revoking the final admin is allowed because the operator can grant access again.
- Retain the existing credentialed origin and JSON request checks. Frontend route guards are supplementary; direct API calls receive the same authorization checks.

## Phase 2 — books and inventory contract

The following schema is implemented. Existing `Book` and public operation signatures remain compatible; admin-only fields use a separate type so archived state is not added to the public contract.

```graphql
enum UserRole {
  CUSTOMER
  ADMIN
}
type Viewer {
  id: ID!
  role: UserRole!
}
enum AdminBookFilter {
  ACTIVE
  ARCHIVED
  ALL
}
type AdminBook {
  id: ID!
  title: String!
  author: String!
  genre: String!
  description: String!
  priceCents: Int!
  stock: Int!
  archived: Boolean!
}
type AdminBooksPage {
  total: Int!
  items: [AdminBook!]!
}
input AdminBookDetailsInput {
  title: String!
  author: String!
  genre: String!
  description: String!
  priceCents: Int!
}
input CreateBookInput {
  details: AdminBookDetailsInput!
  stock: Int!
}
extend type Query {
  viewer: Viewer
  adminBooks(
    search: String
    filter: AdminBookFilter = ACTIVE
    lowStockOnly: Boolean = false
    limit: Int = 20
    offset: Int = 0
  ): AdminBooksPage!
  adminBook(id: ID!): AdminBook
}
extend type Mutation {
  createBook(input: CreateBookInput!): AdminBook!
  updateBook(id: ID!, input: AdminBookDetailsInput!): AdminBook!
  adjustBookStock(id: ID!, delta: Int!): AdminBook!
  setBookArchived(id: ID!, archived: Boolean!): AdminBook!
}
```

### Validation and listing

- Trim title, author, genre, and description. Required lengths: title and author 1–200 characters, genre 1–100, description 1–5,000. Duplicate titles are allowed. Genre is free text; no separate genre-management subsystem.
- Price is an integer from 0 to 1,000,000 cents; stock is an integer from 0 to 1,000,000. Stock delta is a nonzero integer from -1,000,000 to 1,000,000; the resulting stock must stay within 0–1,000,000. These bounds apply to admin writes; historical data is not silently rewritten.
- Validate IDs as positive numeric strings that convert to safe integers. Invalid inputs and unknown mutation IDs return `BAD_USER_INPUT`. An authorized `adminBook` query returns null for a well-formed missing ID. Reject invalid enum values through GraphQL validation.
- Search follows current literal, case-insensitive title/author/genre matching, trims whitespace, and accepts at most 100 characters. Pagination accepts limit 1–50 and nonnegative integer offset; list by numeric book ID ascending. Total applies to all filters before pagination; past-end offsets return an empty page.
- `lowStockOnly` means stock at most 5, including zero. Combine it with the selected archive filter. Five is a fixed threshold for this release.

### Write consistency and archive behavior

- Create accepts initial stock. Metadata edits never accept or overwrite stock. Inventory uses an atomic delta applied to current stored stock; reject an adjustment that would exceed bounds without changing any row. Do not automatically retry a stock mutation after a network error, since the response may have been lost after a successful write.
- Metadata edits use last successful write wins. Return the saved record from every successful mutation. Stock deduction and admin adjustment cannot overwrite each other; checkout still checks current stock and prices in its existing transaction.
- Add `books.archived` as a non-null boolean defaulting to false with a database constraint restricting storage to 0 or 1. Archive and restore are idempotent and preserve IDs, stock, order references, and historical snapshots. Archived books may be edited and have stock adjusted by admins.
- Public `books` and `genres` exclude archived rows; `book(id)` returns null for an archived book. Zero-stock active books remain visible. Existing saved cart lines can remain until the customer removes them.
- `placeOrder` rejects any archived line with `BAD_USER_INPUT`, even when stock remains. Check archive eligibility inside the same transaction as pricing and stock deduction. If archive wins first, checkout fails without partial writes; if checkout wins first, its completed order remains valid.
- A saved cart containing an archived book receives a visible unavailable-book error and retains the cart. Restoring a book returns it to public queries; existing orders always retain their captured title and price.

## Phase 3 — order viewing contract

```graphql
type AdminOrder {
  id: ID!
  userId: ID
  customerName: String!
  email: String!
  createdAt: String!
  totalCents: Int!
  items: [OrderItem!]!
}
type AdminOrdersPage {
  total: Int!
  items: [AdminOrder!]!
}
extend type Query {
  adminOrders(limit: Int = 20, offset: Int = 0): AdminOrdersPage!
  adminOrder(id: ID!): AdminOrder
}
```

- List every order request, including legacy guest orders with null user ID. Order by `createdAt` descending, then numeric ID descending. Limit is 1–50; offset is a nonnegative integer. Total is the count of all orders.
- Detail returns null for a well-formed missing ID and `BAD_USER_INPUT` for a malformed ID after authorization. Preserve the existing timestamp format and `OrderItem` shape; retrieve lines in line-item ID order.
- Return stored customer contact, total, and item snapshots. Never recalculate historical orders using current catalog metadata or prices. Do not associate guest orders with accounts by email.
- Contact details are available only through authorized admin queries. Public catalog queries and `myOrders` must not expose another customer's contact or order data.
- This phase is read-only. No status field, processing mutation, order search, deletion, or export is included.

## Data, migration, and compatibility

- Define membership and archive changes in `src/database/schema.ts`; generate and review SQL and metadata with `bun run db:generate`. Apply through the existing migration wrapper. Preserve verified legacy adoption, fresh database support, all account and session data, book IDs, stock, orders, and line items.
- Migration creates no admin memberships and marks existing books active. The migration must not reject existing descriptions solely because new write limits are narrower; corrections happen through explicit admin edits.
- New GraphQL operations are additive. **Intentional behavior change:** archived books disappear from public queries and become ineligible for checkout. Deploy the matching frontend unavailable-book handling with that change.
- Regenerate backend resolver types from module schemas and coordinate frontend codegen. Keep main `SPEC.md` documents describing implemented behavior until delivery, then update them and mark feature specs Implemented only after acceptance checks pass.
- Before migration on a persisted database, back up the SQLite database using a consistent backup procedure. Prefer restoring that backup and the matching application release for rollback; an older application would ignore archive filtering and must not serve an upgraded database as a rollback strategy.

## Implementation locations

- Existing `src/app.ts` and `src/graphql/context.ts`: session identity and current membership access.
- New `src/modules/admin/`: viewer and authorization helpers, membership repository, and operator command. Wire its script in `package.json`.
- Existing `src/modules/books/`: admin contracts, validation, services, repositories, and public archive filtering.
- Existing `src/modules/orders/`: authorized order listing/detail and transactional archive checks.
- Existing `src/graphql/schema.ts`, `src/graphql/resolvers.ts`, generated resolver types, `src/database/schema.ts`, and `drizzle/`: composition and generated changes.
- Backend API, service, migration, and operator-command tests. Names of new files are implementation choices; these paths identify ownership, not existing files.

## Acceptance criteria and validation

- [x] New/existing accounts have customer access; forged role fields cannot grant membership.
- [x] Grant/revoke affects only the named existing user, is idempotent, and rejects unknown users. Existing sessions lose admin API access on the next request after revocation.
- [x] Guests receive `UNAUTHENTICATED` and customers receive `FORBIDDEN` for every admin field, including aliased fields and mixed GraphQL operations, with no unauthorized reads or writes.
- [x] Admins can create/edit/list/archive/restore books and adjust stock; all specified bounds and query filters are enforced.
- [x] Stock adjustments and checkout deductions compose correctly, negative/overflow adjustments leave data unchanged, and metadata updates do not overwrite stock.
- [x] Archive removes books from public catalog, details, and genres and blocks checkout atomically; restoring exposes the same book ID again.
- [x] Catalog edits and archive changes preserve existing order snapshots and foreign keys.
- [x] Admins can list/detail all order requests, including guest history; customers retain only their own history. Missing IDs, pagination, and timestamp tie ordering behave as specified.
- [x] Fresh, current, and supported legacy databases migrate without data loss; migrated users have no implicit admin access.
- [x] Add focused failing tests before implementation for authorization, inventory transactions, archive eligibility, order privacy, operator commands, and migrations. Run backend `bun run test`, `bun run lint`, and `bun run build`; coordinate frontend codegen and browser tests for each delivered phase.

## Delivered decisions

The delivered defaults are operator-managed membership, stock deltas rather than absolute replacement, a low-stock threshold of 5, metadata edits with last-write-wins behavior, and order viewing without processing. No unresolved requirements remain for this release.

## Verification evidence

Backend tests cover fresh, legacy, and populated authenticated database upgrades, operator grant/revoke commands, immediate API denial after revocation, all book admin operations, atomic stock/checkout behavior, archive eligibility, saved order snapshots, and customer privacy. The complete suite passes 44 tests. Frontend browser acceptance covers all three phases and existing checkout journeys using an isolated in-memory database.
