# The Quiet Shelf API specification

> This document describes implemented behavior. See [the authentication feature spec](specs/authentication/SPEC.md) for the detailed account contract and [the demo-login feature spec](specs/demo-login/SPEC.md) for optional local demo accounts.

> The implemented role and permission model is defined in [the staff roles specification](specs/staff/SPEC.md), with user-directory compatibility details in [the user directory specification](specs/users/SPEC.md).

## Purpose and current scope

The implemented [order workflow specification](specs/order-workflow/SPEC.md)
defines request processing, status history, inventory restoration, and its
fresh-database migration policy.

The implemented [activity history specification](specs/activity/SPEC.md) defines atomic change recording and Admin-only history queries. Its additive migration has not been applied to a production database.

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
- `book(id)` returns one book or `null` when its ID is invalid, missing, or archived. Public lookups accept digit-only IDs, including leading zeroes such as `01`; this is distinct from strict positive safe-integer IDs used by administrative operations.
- `genres` returns the distinct catalog genres in alphabetical order.
- Book prices are integer `priceCents` values. The database stores them as `price_cents`.

## Order requests

- `placeOrder(input)` requires a Better Auth session and accepts 1 to 20 distinct book lines. Each line has a book ID and quantity from 1 to 10. Customer name, email, and user ID come from the server session.
- Module-local Zod schemas require numeric-string book IDs and integer quantities. Services translate the first input failure into GraphQL `extensions.code: BAD_USER_INPUT`; exact validation wording is not a stable API guarantee. Missing sessions return `UNAUTHENTICATED`. The repository checks book existence and stock and calculates totals from stored prices.
- In one SQLite transaction, the server writes the order and its line items and reduces stock. A failed validation or stock check leaves no partial order.
- The response contains an order ID, Submitted status, total in cents, and line titles, quantities, and unit prices. The same transaction creates the initial status event with the authenticated customer's recorded name and role.
- `myOrders(limit, offset)` requires a session, lists only the session user's orders newest first, and returns at most 50 per page. `myOrder(id)` has the same owner scope and returns the customer-safe status timeline; a missing or non-owned ID returns null. No query claims an order by matching email.
- Requests move from Submitted to Accepted to Completed, or from Submitted/Accepted to Cancelled with a 1–500-character trimmed customer-visible reason. Completed and Cancelled are terminal. Repeating the current requested status is a no-op; stale different transitions return CONFLICT. Cancellation restores saved quantities once, including archived books, and records its stock and status activity atomically. Email verification, self-service password recovery, payment, shipping, email notification, customer cancellation, reopening, bulk processing, and line edits are not implemented. An admin can set another account's password through `resetUserPassword`.

## Store administration

- `viewer` reports the signed-in user's ID and server-owned Customer, Staff, or Admin role, or null without a valid session. `user_roles` is the sole role authority; an absent row resolves to Customer. Signup does not assign a privileged role.
- Staff and Admin may use `adminBooks`, `adminBook`, `createBook`, `updateBook`, and `adjustBookStock`. Only Admin may use `setBookArchived`. Metadata edits exclude stock; signed adjustments are atomic and bounded. Low stock means five or fewer units.
- Archived books are absent from public catalog/details/genres and cannot be ordered. Archive/restore preserves IDs, stock, references, and prior order snapshots.
- Staff and Admin may use `adminOrders(status, limit, offset)` and `adminOrder` to read stored requests, contact/price snapshots, statuses, and attributed oldest-first status history. Both roles have PROCESS_ORDERS and may make only the allowed transitions. Customer `myOrders`/`myOrder` remain owner-scoped and never expose staff attribution.
- Only Admin may use `adminUsers`, `adminUser`, `setUserRole`, and `resetUserPassword`. Directory search/filter includes Customer, Staff, and Admin. `setUserRole` assigns one role for an existing user and does not change identity, credentials, sessions, or orders. See [the staff roles specification](specs/staff/SPEC.md).
- `setUserAdminAccess` and legacy `setCustomerAdminAccess` are deprecated compatibility mutations: true assigns Admin and false assigns Customer. Deprecated legacy user query/detail/password fields retain their declared types for existing clients.
- `adminActivity` is Admin-only and returns the newest recorded catalog, account, and order-status changes first. It supports bounded pagination plus actor, action, changed-field, target, and UTC time-range filters. Book history is the same query filtered to a book target and includes cancellation stock restoration. Staff actions are recorded but Staff cannot read activity. The log begins after the updated backend runs with migration `0005_panoramic_invisible_woman` applied; it does not reconstruct prior changes.
- Workspace permission guards read the current stored role before private validation or lookup and supply the authenticated user to resolver logic. Admin has `PROCESS_ORDERS`, `MANAGE_CATALOG`, `VIEW_ORDERS`, `ARCHIVE_BOOKS`, `MANAGE_USERS`, and `VIEW_ACTIVITY`; Staff has `PROCESS_ORDERS`, `MANAGE_CATALOG`, and `VIEW_ORDERS`; Customer and unknown roles have none of these workspace permissions. Guests receive `UNAUTHENTICATED`; users without the required permission receive `FORBIDDEN`. A role change affects the next request.
- Operator `admin:access` grant/revoke acts only on existing user IDs against the configured database, assigning Admin or Customer respectively. See [the staff roles specification](specs/staff/SPEC.md) for role and recovery limits.

## Data and operation

- Drizzle defines storefront tables in `src/database/schema.ts` and Better Auth's `user`, `session`, `account`, and `verification` tables in `src/database/auth-schema.ts`, retaining foreign keys and check constraints. Queries stay behind repository interfaces. SQL migrations and metadata are committed under `drizzle/`. Migrations run when the database opens; `bun run db:generate` generates changes and `bun run db:migrate` applies them explicitly through the compatibility wrapper.
- The migration wrapper verifies the original `user_version = 1` schema before adopting its baseline in the Drizzle journal. Fresh and empty old databases can migrate. A populated pre-workflow orders table without `status` fails before any migration write, requiring an explicit development reset rather than inventing status history. Unsupported versions or legacy schemas fail startup.
- Migration `0004_sad_reavers` copies existing `admin_memberships` to `user_roles` as Admin and drops `admin_memberships`. Before applying it to production, stop writers and make a consistent SQLite backup. Do not run an older backend binary against that migrated database; rollback requires restoring the pre-migration backup with compatible application versions.
- Migration `0005_panoramic_invisible_woman` adds the additive `activity_events` table and its indexes without changing existing business data. Apply it through the migration wrapper with writers stopped and a consistent SQLite backup. A prior compatible binary can ignore the table but will leave a documented logging gap; preserve the table during rollback.
- Migration `0006_serious_killraven` adds order statuses and timeline events. It is supported only for fresh or empty pre-workflow order data. Do not run it against a populated old-order database: its guard fails safely and requires an explicit local reset/reseed or a separately designed data migration. Never make that reset automatic or apply it to production data.
- Development seeds twelve sample books once. Production does not seed automatically; `bun run db:seed` is explicit. `bun run demo:seed` is a separate local-only account seed that refuses production before opening the database; it neither seeds nor resets catalog/order data.
- `DATABASE_PATH`, `PORT`, `FRONTEND_ORIGIN`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, and `NODE_ENV` are validated at startup. The database file is runtime data and is not committed.
- Bun 1.3.14 manages dependencies using committed `bun.lock` and `bun install --frozen-lockfile` for reproducible installs. Node.js 24 or later remains the runtime.

## Acceptance checks

- `bun run test` covers catalog queries and distinct genres, sign-up/sign-in/sign-out, session-scoped order history/detail, workflow permissions/transitions/conflicts, price snapshots, cancellation restoration and atomic rollback, migration guards, seed behavior, configuration validation, and activity permissions, snapshots, aliases, filters, and atomic rollback.
- Run `bun run lint` and `bun run build` for static and build checks.
