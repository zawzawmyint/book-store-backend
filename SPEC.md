# The Quiet Shelf API specification

> **Proposed engineering work:** [Backend readability and consistency](specs/readability-consistency/SPEC.md) describes incremental refactoring with unchanged API and database behavior. Its acceptance criteria are not yet verified.

> **Implemented infrastructure:** [Database support](specs/database-support/SPEC.md) provides SQLite development/test and PostgreSQL production support with shared application behavior.

> **Implemented delivery:** [Delivery](specs/delivery/SPEC.md) is the current checkout and fulfillment contract.

> **Implemented payment-key recovery:** [Payment operation keys](specs/payment-operation-keys/SPEC.md) defines durable Stripe idempotency identities and restart recovery.

> **Implemented workspace dashboard:** [Dashboard](specs/dashboard/SPEC.md) defines Staff operations and Admin-only financial reporting.

> **Implemented workspace search:** [Workspace search](specs/workspace-search/SPEC.md) adds Staff/Admin Books and Orders search plus an additive order filter, with verified SQLite/PostgreSQL parity and browser coverage.

> This document describes implemented behavior. See [the Stripe checkout feature spec](specs/stripe-checkout/SPEC.md) for test-payment details, [the authentication feature spec](specs/authentication/SPEC.md) for the account contract, and [the demo-login feature spec](specs/demo-login/SPEC.md) for optional local demo accounts.

> The implemented role and permission model is defined in [the staff roles specification](specs/staff/SPEC.md), with user-directory compatibility details in [the user directory specification](specs/users/SPEC.md).

## Purpose and current scope

The implemented [Stripe checkout specification](specs/stripe-checkout/SPEC.md)
defines hosted card payments in Stripe test mode, payment expiry, and full refunds.

The implemented [order workflow specification](specs/order-workflow/SPEC.md)
defines request processing, status history, inventory restoration, and its
fresh-database migration policy.

The implemented [activity history specification](specs/activity/SPEC.md) defines atomic change recording and Admin-only history queries. Its additive migration has not been applied to a production database.

The implemented [dashboard specification](specs/dashboard/SPEC.md) defines the
read-only workspace aggregates, bounded previews, exact-cent 7/30/90-day summaries,
and the fixed Asia/Dubai reporting calendar. It adds no persistence schema change.

Provide a GraphQL catalog and authenticated checkout API for the separate storefront.
New orders require Stripe hosted Checkout in test mode with a required delivery address.

## HTTP surface

- `POST /graphql` accepts GraphQL operations. Module schemas composed in `src/graphql/schema.ts` are the authoritative field and type contract.
- `GET /health` returns `{ "status": "ok" }`.
- `POST /api/payments/stripe/webhook` verifies Stripe's signed test-mode events. It
  is a provider endpoint, not a browser API, and has no cookie/origin requirement.
- Better Auth handles email-and-password account requests and cookie sessions under `/api/auth/*`. A signed-in user can update their own display name and change their password on those existing routes. Name updates trim to 1–120 characters. Email, image, role, and user ID stay unchanged. Password changes require the current password and a new password of 8–128 characters, revoke other sessions, and keep the current browser session. Later order requests use the saved name; existing orders keep their stored contact snapshots. See [the account profile spec](specs/profile/SPEC.md).
- Browser access to `/graphql` and `/api/auth/*` is limited by the configured `FRONTEND_ORIGIN` CORS origin. Authenticated GraphQL POST requests require that origin and JSON content.

## Catalog

- `books(search, limit, offset)` returns `{ total, items }`. Defaults are `limit: 12` and `offset: 0`.
- Search trims the input and matches title, author, or genre as case-insensitive text. SQL wildcard characters in input are treated literally on both supported databases.
- The service accepts search text up to 100 characters, a whole-number limit from 1 to 24, and a nonnegative whole-number offset.
- `book(id)` returns one book or `null` when its ID is invalid, missing, or archived. Public lookups accept digit-only IDs, including leading zeroes such as `01`; this is distinct from strict positive safe-integer IDs used by administrative operations.
- `genres` returns the distinct catalog genres in alphabetical order.
- Book prices are integer `priceCents` values. The database stores them as `price_cents`.

## Order requests

The former addressless Accepted/Completed and `LEGACY_UNPAID` workflow described in
older feature notes is historical. The current requirements for delivery address,
quote/review, immutable fee-inclusive amounts, payment state, shipment and cancellation
are authoritative in [the delivery specification](specs/delivery/SPEC.md).

- `deliveryOptions` and `quoteCheckout(input)` require a Better Auth session. They expose enabled country codes, fee and USD currency, and produce a non-reserving server quote for a valid delivery address. `createCheckout(input)` requires the reviewed address, expected fee and expected total, 1 to 20 distinct book lines, and a UUID request key. Each line has a book ID and quantity from 1 to 10. Customer name, email, and user ID come from the server session. `placeOrder`
  remains deprecated for schema compatibility and rejects new placement.
- Module-local Zod schemas require numeric-string book IDs and integer quantities. Services translate the first input failure into GraphQL `extensions.code: BAD_USER_INPUT`; exact validation wording is not a stable API guarantee. Missing sessions return `UNAUTHENTICATED`. The repository checks book existence and stock and calculates totals from stored prices.
- In one provider-scoped transaction, the server writes a pending payment-required order and
  its line items, reserves stock, and creates the initial status event. A failed
  validation or stock check leaves no partial order. Stripe work happens outside the
  transaction through durable operations. New checkout/refund operations persist UUID
  identities (`checkout:<UUID>` and `refund:<UUID>`) before provider calls; retries and
  restarts use that saved identity. Existing deterministic operation IDs remain
  recoverable and are never rotated automatically.
- The response contains the order and a hosted checkout URL while its session is
  open. Saved USD totals are immutable: `subtotalCents + deliveryFeeCents = totalCents`.
  Payment confirmation is provider evidence, never a browser return URL.
- `myOrders(limit, offset)` requires a session, lists only the session user's orders newest first, and returns at most 50 per page. `myOrder(id)` has the same owner scope and returns the customer-safe status timeline; a missing or non-owned ID returns null. No query claims an order by matching email.
- Payment-required requests begin Submitted and may move to Preparing only after
  verified payment, then to Shipped and Delivered. Cancellation is allowed only before
  shipment, requires a 1–500-character trimmed customer-visible reason, restores stock
  once, and queues a full fee-inclusive refund for paid orders. Delivered and Cancelled
  are terminal. Repeating the current requested status is a no-op; stale different
  transitions return CONFLICT. Customer cancellation, partial refunds, live payments,
  and line edits are not implemented.

## Store administration

- `viewer` reports the signed-in user's ID and server-owned Customer, Staff, or Admin role, or null without a valid session. `user_roles` is the sole role authority; an absent row resolves to Customer. Signup does not assign a privileged role.
- Staff and Admin may use `adminBooks`, `adminBook`, `createBook`, `updateBook`, and `adjustBookStock`. Only Admin may use `setBookArchived`. Metadata edits exclude stock; signed adjustments are atomic and bounded. Low stock means five or fewer units.
- Archived books are absent from public catalog/details/genres and cannot be ordered. Archive/restore preserves IDs, stock, references, and prior order snapshots.
- Staff and Admin may use `adminOrders(status, limit, offset)` and `adminOrder` to read stored requests, contact/price snapshots, statuses, and attributed oldest-first status history. Both roles have PROCESS_ORDERS and may make only the allowed transitions. Customer `myOrders`/`myOrder` remain owner-scoped and never expose staff attribution.
- Only Admin may use `adminUsers`, `adminUser`, `setUserRole`, and `resetUserPassword`. Directory search/filter includes Customer, Staff, and Admin. `setUserRole` assigns one role for an existing user and does not change identity, credentials, sessions, or orders. See [the staff roles specification](specs/staff/SPEC.md).
- `setUserAdminAccess` and legacy `setCustomerAdminAccess` are deprecated compatibility mutations: true assigns Admin and false assigns Customer. Deprecated legacy user query/detail/password fields retain their declared types for existing clients.
- `adminActivity` is Admin-only and returns the newest recorded catalog, account, and order-status changes first. It supports bounded pagination plus actor, action, changed-field, target, and UTC time-range filters. Book history is the same query filtered to a book target and includes cancellation stock restoration. Staff actions are recorded but Staff cannot read activity. The log begins after the updated backend runs with migration `0005_panoramic_invisible_woman` applied; it does not reconstruct prior changes.
- Workspace permission guards read the current stored role before private validation or lookup and supply the authenticated user to resolver logic. Admin has `PROCESS_ORDERS`, `MANAGE_CATALOG`, `VIEW_ORDERS`, `ARCHIVE_BOOKS`, `MANAGE_USERS`, `VIEW_ACTIVITY`, and `VIEW_DASHBOARD_FINANCE`; Staff has `PROCESS_ORDERS`, `MANAGE_CATALOG`, and `VIEW_ORDERS`; Customer and unknown roles have none of these workspace permissions. `workspaceDashboard` requires both `VIEW_ORDERS` and `MANAGE_CATALOG`, while `adminDashboardFinance` requires the Admin-only finance permission. Guests receive `UNAUTHENTICATED`; users without the required permission receive `FORBIDDEN`. A role change affects the next request.
- Operator `admin:access` grant/revoke acts only on existing user IDs against the configured database, assigning Admin or Customer respectively. See [the staff roles specification](specs/staff/SPEC.md) for role and recovery limits.

## Data and operation

- Drizzle defines provider-specific storefront and Better Auth tables while preserving one logical data contract. SQLite definitions are in `src/database/schema.ts` and `auth-schema.ts`; PostgreSQL definitions are in `src/database/postgresql/`. Repositories expose asynchronous provider-neutral operations, while provider adapters own driver calls, transactions, locking, and migration details. SQLite SQL/migration metadata remain in `drizzle/`; PostgreSQL has an independent baseline in `drizzle/postgresql/`.
- SQLite retains automatic migration and its legacy-adoption wrapper, which verifies the original `user_version = 1` schema before adopting its baseline. PostgreSQL migration is explicit through `bun run db:migrate`; startup verifies the migration journal and required relations before serving requests. A populated pre-workflow SQLite orders table without `status` fails before any migration write, requiring an explicit development reset rather than inventing status history. Unsupported SQLite legacy schemas or versions fail startup.
- Historical SQLite migration/recovery notes: migration `0004_sad_reavers` copies existing `admin_memberships` to `user_roles` as Admin and drops `admin_memberships`. Before applying it to a persistent SQLite database, stop writers and make a consistent SQLite backup. Do not run an older backend binary against that migrated database; rollback requires restoring the pre-migration backup with compatible application versions.
- Historical SQLite migration/recovery notes: migration `0005_panoramic_invisible_woman` adds the additive `activity_events` table and its indexes without changing existing business data. Apply it through the SQLite migration wrapper with writers stopped and a consistent SQLite backup. A prior compatible binary can ignore the table but will leave a documented logging gap; preserve the table during rollback.
- Historical SQLite migration/recovery notes: migration `0006_serious_killraven` adds order statuses and timeline events. It is supported only for fresh or empty pre-workflow SQLite order data. Do not run it against a populated old-order SQLite database: its guard fails safely and requires an explicit local reset/reseed or a separately designed data migration. Never make that reset automatic or apply it to production data.
- Historical SQLite migration/recovery note: migration `0007_youthful_crystal`
  introduced payment records for the former workflow. The delivery migration requires
  fresh/reset local data rather than converting populated historical orders. Back up
  persisted data before applying any migration.
- SQLite development seeds twelve sample books once. PostgreSQL never auto-seeds; `bun run db:seed` is explicit for either selected provider and refuses production before opening a database. `bun run demo:seed` is a separate local-only account seed that also refuses production before opening the database; neither seed command resets catalog/order data.
- `DB_PROVIDER`, `DATABASE_PATH`, `DATABASE_URL`, `PG_POOL_MAX`, `PG_TLS_MODE`,
  `PG_CA_FILE`, `PORT`, `FRONTEND_ORIGIN`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`,
  `NODE_ENV`, `DELIVERY_ENABLED`, `DELIVERY_COUNTRY_CODES`, `DELIVERY_FEE_CENTS`, and
  the Stripe checkout configuration are validated at startup. SQLite is
  the development/test default; production requires PostgreSQL and verified TLS.
  Checkout
  is disabled by default and enabled only with test server and webhook signing secrets;
  live keys and live provider resources are rejected. The database file is runtime data
  and is not committed.
- Bun 1.3.14 manages dependencies using committed `bun.lock` and `bun install --frozen-lockfile` for reproducible installs. Node.js 24 or later remains the runtime.

## Acceptance checks

- `bun run test` covers catalog queries and distinct genres, account flows,
  session-scoped orders, payment/provider confirmation and recovery, payment-aware
  workflow permissions/transitions, refunds, migration guards, configuration, and
  Activity atomicity.
- Run `bun run lint` and `bun run build` for static and build checks.
- `bun run test:postgres` provisions disposable PostgreSQL 17.10 and runs shared
  provider-parity, migration, CLI, and compiled-application checks. Browser journeys
  run against SQLite by default and PostgreSQL through `bun run test:postgres:browser`.
