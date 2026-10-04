# The Quiet Shelf API specification

> This document describes implemented behavior. See [the authentication feature spec](specs/authentication/SPEC.md) for the detailed account contract.

## Purpose and current scope

Provide a GraphQL catalog and authenticated order-request API for the separate storefront. The API records requests but does not take payment or arrange delivery.

## HTTP surface

- `POST /graphql` accepts GraphQL operations. Module schemas composed in `src/graphql/schema.ts` are the authoritative field and type contract.
- `GET /health` returns `{ "status": "ok" }`.
- Better Auth handles email-and-password account requests and cookie sessions under `/api/auth/*`. A signed-in user can update their own display name and change their password on those existing routes. Name updates trim to 1–120 characters. Email, image, role, and user ID stay unchanged. Password changes require the current password and a new password of 8–128 characters, revoke other sessions, and keep the current browser session. Later order requests use the saved name; existing orders keep their stored contact snapshots. See [the account profile spec](specs/profile/SPEC.md).
- Browser access to `/graphql` and `/api/auth/*` is limited by the configured `FRONTEND_ORIGIN` CORS origin. Authenticated GraphQL POST requests require that origin and JSON content.

## Catalog

- `books(search, limit, offset)` returns `{ total, items }`. Defaults are `limit: 12` and `offset: 0`.
- Search trims the input and matches title, author, or genre as case-insensitive SQLite `LIKE` text. SQL wildcard characters in input are treated literally.
- The service accepts search text up to 100 characters, a whole-number limit from 1 to 24, and a nonnegative whole-number offset.
- `book(id)` returns one book or `null` when no matching numeric ID exists.
- `genres` returns the distinct catalog genres in alphabetical order.
- Book prices are integer `priceCents` values. The database stores them as `price_cents`.

## Order requests

- `placeOrder(input)` requires a Better Auth session and accepts 1 to 20 distinct book lines. Each line has a book ID and quantity from 1 to 10. Customer name, email, and user ID come from the server session.
- Module-local Zod schemas require numeric-string book IDs and integer quantities. Services translate input failures into GraphQL `extensions.code: BAD_USER_INPUT`; missing sessions return `UNAUTHENTICATED`. The repository checks book existence and stock and calculates totals from stored prices.
- In one SQLite transaction, the server writes the order and its line items and reduces stock. A failed validation or stock check leaves no partial order.
- The response contains an order ID, total in cents, and line titles, quantities, and unit prices.
- `myOrders(limit, offset)` requires a session, lists only the session user's orders newest first, and returns at most 50 per page. Legacy guest orders remain stored with no user ID and are not claimed by matching email.
- Email verification, self-service password recovery, payment, shipping, email notification, and order processing are not implemented. An admin can set another account's password through `resetCustomerPassword`.

## Store administration

- `viewer` reports the signed-in user's ID and server-owned Customer/Admin role, or null without a valid session. `admin_memberships` grants access; new/existing accounts are customers until an operator explicitly grants membership.
- Admin-only `adminBooks`, `adminBook`, `createBook`, `updateBook`, `adjustBookStock`, and `setBookArchived` manage catalog and inventory. Metadata edits exclude stock; signed adjustments are atomic and bounded. Low stock means five or fewer units.
- Archived books are absent from public catalog/details/genres and cannot be ordered. Archive/restore preserves IDs, stock, references, and prior order snapshots.
- Admin-only `adminOrders` and `adminOrder` expose stored requests and contact snapshots, including legacy guest history. Customer `myOrders` remains owner-scoped.
- Admin-only `adminCustomers` lists registered accounts, with name, email, Customer or Admin role, and join time. Search matches name or email, and a role filter selects all, customers, or admins. `setCustomerAdminAccess` grants or revokes membership for an existing user and does not create or edit the account. See [the customer directory spec](specs/customers/SPEC.md).
- Admin-only `adminCustomer` reads one registered account. `resetCustomerPassword` sets a new 8–128 character password for another account, using the Better Auth hasher, and deletes that account's sessions. The caller's own password stays on Better Auth `change-password`. See [the customer details spec](specs/customer-details/SPEC.md).
- Every admin resolver checks current membership before domain validation or lookup. Guests receive `UNAUTHENTICATED`, customers `FORBIDDEN`. Membership revocation affects the next request.
- Operator `admin:access` grant/revoke acts only on existing user IDs against the configured database. See [the admin feature spec](specs/admin/SPEC.md) for exact contracts and limits.

## Data and operation

- Drizzle defines storefront tables in `src/database/schema.ts` and Better Auth's `user`, `session`, `account`, and `verification` tables in `src/database/auth-schema.ts`, retaining foreign keys and check constraints. Queries stay behind repository interfaces. SQL migrations and metadata are committed under `drizzle/`. Migrations run when the database opens; `bun run db:generate` generates changes and `bun run db:migrate` applies them explicitly through the compatibility wrapper.
- The migration wrapper verifies the original `user_version = 1` schema before adopting its baseline in the Drizzle journal, preserving existing catalog and order data. Fresh databases run the baseline. Unsupported versions or legacy schemas fail startup.
- Development seeds twelve sample books once. Production does not seed automatically; `bun run db:seed` is explicit.
- `DATABASE_PATH`, `PORT`, `FRONTEND_ORIGIN`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, and `NODE_ENV` are validated at startup. The database file is runtime data and is not committed.
- Bun 1.3.14 manages dependencies using committed `bun.lock` and `bun install --frozen-lockfile` for reproducible installs. Node.js 24 or later remains the runtime.

## Acceptance checks

- `bun run test` covers catalog queries and distinct genres, sign-up/sign-in/sign-out, session-scoped order history, unauthenticated access, order pricing, stock rejection, transactional rollback, migration, seed behavior, and configuration validation.
- Run `bun run lint` and `bun run build` for static and build checks.
