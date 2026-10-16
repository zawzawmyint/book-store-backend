# The Quiet Shelf API

Implemented feature: [Account carts](specs/account-carts/SPEC.md) stores each verified user's bag on the server, keeps a versioned guest bag locally, and preserves old raw arrays only for confirmed import.

Implemented feature: [Auth email verification and recovery](specs/auth-email/SPEC.md) requires verified email for account access, exposes read-only verification status in the Admin user directory, provides password recovery, and sends mail through configured SMTP.

Implemented feature: [Operational logging and readiness](specs/operational-logging-readiness/SPEC.md) adds structured console events, server-generated request correlation, and database readiness at `GET /ready`.

An Express + GraphQL + Drizzle bookstore API with Zod input validation. SQLite is the
development/test default and PostgreSQL is supported for production. This folder is its
own Git repository and runs independently from the frontend.

See [SPEC.md](SPEC.md) for the implemented API behavior, [the catalog upgrade](specs/catalog-upgrade/SPEC.md) for public catalog filters and ordering, [specs/operational-logging-readiness/SPEC.md](specs/operational-logging-readiness/SPEC.md) for logging and readiness operations, [specs/account-carts/SPEC.md](specs/account-carts/SPEC.md) for account-cart ownership and migration constraints, [the database support spec](specs/database-support/SPEC.md) for provider operation, [specs/payment-operation-keys/SPEC.md](specs/payment-operation-keys/SPEC.md) for durable payment idempotency and recovery, [specs/authentication/SPEC.md](specs/authentication/SPEC.md) for the account feature contract, [specs/order-workflow/SPEC.md](specs/order-workflow/SPEC.md) for request processing, [specs/demo-login/SPEC.md](specs/demo-login/SPEC.md) for local demo accounts, [specs/staff/SPEC.md](specs/staff/SPEC.md) for roles and permissions, [specs/users/SPEC.md](specs/users/SPEC.md) for user-directory compatibility, [specs/activity/SPEC.md](specs/activity/SPEC.md) for the Admin-only activity contract, and [specs/dashboard/SPEC.md](specs/dashboard/SPEC.md) for workspace reporting.

## Development workflow

Implemented engineering work: [Backend readability and consistency](specs/readability-consistency/SPEC.md) records the backend naming, dependency-composition, service-contract, and adapter readability conventions. It did not change the API contract.

Future behavior changes follow spec-driven development (SDD) and test-driven development (TDD). Write or revise the relevant spec before implementation, with a proposed contract and testable acceptance criteria. For each criterion, write a focused failing test, confirm the failure is caused by the missing behavior, make it pass, and refactor. Finish with the checks below and coordinate frontend tests for contract changes; then update the spec to reflect the delivered behavior and mark a feature spec `Implemented`. See [AGENTS.md](AGENTS.md) for the full workflow and cross-repository rules.

## Start

Requires Bun 1.3.14 for package management and Node.js 24 or later for runtime and tooling. Each repository commits its own `bun.lock`; use `bun install` when changing dependencies.

```powershell
bun install --frozen-lockfile
Copy-Item .env.example .env
# Set BETTER_AUTH_SECRET in .env to a random secret of at least 32 characters.
bun run dev
```

The backend's `bunfig.toml` disables dependency install scripts. Its SQLite driver ships native binaries; this avoids an unnecessary local `node-gyp` rebuild on Windows. PostgreSQL parity tests use the pinned embedded PostgreSQL 17.10 package. If Bun reports its platform setup script as blocked after installation, run `bun pm trust @embedded-postgres/windows-x64` on Windows or `bun pm trust @embedded-postgres/linux-x64` on Linux, then reinstall as directed by Bun. PostgreSQL 17.10 was verified on Windows x64.

The API starts at `http://localhost:4000/graphql`; Better Auth serves `/api/auth/*`; `GET /health` returns the liveness response; and `GET /ready` checks the selected database. Readiness returns `200 { "status": "ready" }` or `503 { "status": "unavailable" }`, with `Cache-Control: no-store`. SQLite migrations run on startup and development seeds twelve catalog books once. PostgreSQL never auto-migrates or auto-seeds: apply `bun run db:migrate` first, then run `bun run db:seed` only when you intentionally want the sample catalog. Both catalog and demo seed commands reject production before opening a database. The `data/` directory is ignored by Git.

## Operational logging and readiness

The server writes one structured JSON event per line to the console. Each HTTP response receives a fresh, server-owned `X-Request-ID`; use it to correlate request and GraphQL outcome events locally. The logger emits only allowlisted context and safe application error categories, never raw exception messages or stacks. The additive error boundary keeps malformed/aborted JSON at 400, oversized JSON at 413, and unsupported charset or encoding at 415, without logging request bodies. Normal `/health` and successful `/ready` polling produce no request-completion log events; readiness failure and recovery transitions do.

There are no log files, log database, telemetry vendor, automatic alerts, or logging environment variables. Configure log collection, retention, alerts, and the hosting readiness target (`/ready`) outside this application. A PostgreSQL readiness query has a two-second client-side timeout; shared in-flight work is retained until the driver settles, so the HTTP deadline does not cancel an underlying query. The established PostgreSQL pool acquisition and general statement limits remain ten and thirty seconds. `payment.operation_processed` records processing rather than durable provider completion; a failed refund result emits the safe `payment.refund_failed` event.

Configure `PORT`, `DB_PROVIDER`, `DATABASE_PATH`, `DATABASE_URL`, `PG_POOL_MAX`,
`PG_TLS_MODE`, `PG_CA_FILE`, `FRONTEND_ORIGIN`, `BETTER_AUTH_URL`,
`BETTER_AUTH_SECRET`, `NODE_ENV`, and the SMTP settings below in `.env` as applicable. SQLite is the default
outside production. Production requires `DB_PROVIDER=postgresql`, a PostgreSQL URL,
and `PG_TLS_MODE=verify-full`; `PG_CA_FILE` may provide a trusted CA bundle. URL TLS
parameters are rejected so TLS policy is controlled only by these environment variables.
Set `BETTER_AUTH_URL` to the public storefront origin that proxies `/api/auth`
(localhost:5173 in development). The secret must be random and at least 32 characters;
do not use the schema generator's test secret in a running server.

Production requires complete SMTP configuration: `SMTP_HOST`, `SMTP_PORT`,
`SMTP_SECURE`, `SMTP_USERNAME`, `SMTP_PASSWORD`, and `SMTP_FROM`; `SMTP_REPLY_TO`
is optional. Use port 587 with `SMTP_SECURE=false` (STARTTLS) or 465 with
`SMTP_SECURE=true` (TLS). `SMTP_FROM` becomes the address in the **The Quiet Shelf**
display sender and must be authorized by the provider. Ethereal is accepted only
outside production. Configure the provider credentials, sender/domain verification,
and HTTPS frontend/auth origins yourself; never commit them. SMTP delivery is
best-effort (there is no durable queue), so users recover from a failed delivery by
requesting another verification or reset email.

Delivery checkout is disabled until all three delivery variables are explicitly set:
`DELIVERY_ENABLED=true`, a comma-separated uppercase ISO country allowlist in
`DELIVERY_COUNTRY_CODES`, and `DELIVERY_FEE_CENTS`. The current local demo choice is
`US` and `500` cents (USD 5); it is not a production coverage or rate decision.

Auth request bodies are capped at 64 KiB. Sign-up and account updates trim names and enforce 1–120 characters. Rate limiting uses the direct socket address by default and ignores caller-supplied forwarding headers. Behind a reverse proxy, set `AUTH_TRUSTED_PROXY_IP` to its peer IP only when that proxy **overwrites** `X-Real-IP` and direct access to the API is blocked. Without this setting, customers behind the proxy share one rate-limit bucket.

## Local demo accounts

For local development only, run `bun run demo:seed` from this directory after
configuring `.env`. It creates or verifies Demo Customer, Staff, and Admin accounts
with the shared password `BookstoreDemo123!`; see
[the backend demo-login specification](specs/demo-login/SPEC.md) for their emails
and repeat-seed behavior. The command refuses production before opening the
database, does not seed or reset catalog/order data, and does not provide an HTTP
endpoint. If a demo password was changed, reset it manually through the existing
Admin user-management UI before running the command again; a detected password
mismatch leaves demo accounts and roles unchanged. The exact reserved demo accounts
are marked verified after their password is checked; ordinary accounts and real
Staff/Admin accounts still require verification.

## Email-verification rollout

New sign-ups have no usable session until their email is verified; verification and
password reset both require a subsequent sign-in. Before enabling this flow for an
existing database, preview then apply removal of sessions belonging to unverified
accounts:

```powershell
bun run auth:revoke-unverified preview
bun run auth:revoke-unverified apply
```

The command uses the configured database, reports counts only, and deletes only
unverified users' sessions. It preserves users, credentials, roles, and orders. It
does not mark accounts verified or apply the change automatically.

## GraphQL examples

Run these in the GraphQL explorer at `/graphql`:

```graphql
query BrowseBooks {
  books(search: "Gothic Fiction", limit: 12, offset: 0) {
    total
    items {
      id
      title
      author
      priceCents
      stock
    }
  }
  genres
}
```

```graphql
mutation StartCheckout {
  createCheckout(
    input: {
      items: [{ bookId: "1", quantity: 1 }]
      requestKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      deliveryAddress: {
        recipientName: "Ada Lovelace"
        phone: "+1 555 555 0100"
        addressLine1: "1 Example Street"
        city: "Example"
        countryCode: "US"
      }
      expectedDeliveryFeeCents: 500
      expectedTotalCents: 2500
    }
  ) {
    checkoutUrl
    order {
      id
      status
      totalCents
      payment {
        status
        currency
      }
    }
  }
}
```

Checkout requires a Better Auth session. Before a checkout attempt, use
`deliveryOptions` and `quoteCheckout` to obtain a server quote for the entered address.
The checkout request includes the reviewed address and expected fee/total; the server
recalculates prices and rejects a stale review. It stores the normalized address, fee,
subtotal and final total immutably, reserves stock, and saves a Submitted order with
its initial timeline event. The browser never supplies an authoritative price or user ID.
The hosted URL is Stripe test mode only; payment confirmation comes from signed webhook
or provider reconciliation, not the redirect. `myOrders(limit, offset)` and `myOrder(id)`
return only the signed-in user's requests; the detail timeline never includes staff
attribution. The GraphQL endpoint is the catalog and checkout API; Better Auth handles
account requests under `/api/auth/*`.

## Architecture

GraphQL resolvers play the **controller** role in MVC: they receive API requests and translate application errors into GraphQL errors. Services validate input through module-local Zod schemas and enforce business rules. Repositories contain Drizzle queries. Validation failures retain the GraphQL `BAD_USER_INPUT` code. The React repository contains the views.

```text
src/
  app.ts                 Express and Apollo setup
  server.ts              Process startup and shutdown
  config/env.ts          Environment validation
  database/
    runtime.ts           Provider selection, lifecycle, and readiness
    connection.ts        SQLite connection and automatic migration
    schema.ts            SQLite storefront tables and constraints
    auth-schema.ts       SQLite Better Auth tables generated for Drizzle
    migrations.ts        SQLite migrations and legacy adoption
    sqlite/              SQLite adapter implementation
    postgresql/          PostgreSQL schemas, adapter, connection, and migration helpers
    persistence.ts       Provider-neutral repository store composition
    migrate-cli.ts       Explicit migration entry point
    seed.ts              Optional catalog seed
  auth.ts                Better Auth server configuration
  graphql/
    schema.ts            Composes module GraphQL types
    resolvers.ts         Composes module resolvers
    generated/           Generated resolver types
  modules/
    books/
      book.schema.ts     Book GraphQL contract
      book.resolvers.ts  Book query controllers
      book.types.ts      Catalog interfaces and domain types
      book.validation.ts Catalog Zod input schemas
      book.service.ts    Catalog application rules
      book.repository.ts Catalog Drizzle queries
    orders/
      order.schema.ts    Order GraphQL contract
      order.resolvers.ts Order mutation controller
      order.types.ts     Order interfaces and domain types
      order.validation.ts Order Zod input schema
      order.service.ts   Order application rules
      order.repository.ts Transactional Drizzle queries
    payments/             Provider, durable-operation, and recovery boundary
  shared/errors.ts       Application validation error
test/                     API and database integration tests
drizzle/                  Committed SQL migrations and metadata
```

## Admin access and operations

The storefront has three roles: Customer, Staff, and Admin. Signup creates a Customer; `user_roles` is the sole server-owned role authority, with no row also resolving to Customer. Staff can manage catalog metadata, prices, and stock; read order requests; and process allowed status transitions. Admin adds archive/restore and user management, including role assignment and another user's password reset. All three roles can still use normal shopping and their own account profile. See [the staff roles spec](specs/staff/SPEC.md). The deprecated Boolean access mutations and customer-named GraphQL fields remain only for compatible clients.

Start the API to apply SQLite migrations, or run `bun run db:migrate` using the configured `.env`. For PostgreSQL, run `bun run db:migrate` before startup; startup then verifies the applied migration journal and required tables. Register the intended account through the storefront, verify the account identity, and obtain its exact user ID from the signed-in `viewer { id role }` GraphQL query or the configured database. Run these operator commands **from this backend directory**:

```powershell
bun run admin:access -- grant <user-id>
bun run admin:access -- revoke <user-id>
```

Both commands are idempotent and reject unknown users. They do not create accounts, passwords, or public promotion endpoints. `grant` assigns Admin and `revoke` assigns Customer. The current role is checked on each protected request, so a role change affects the next request even with an existing session. Reload or focus the storefront to refresh its navigation/access display after a role change.

Metadata edits exclude stock; inventory changes are signed deltas applied to current stored stock. A lost mutation response leaves the result uncertain: check inventory and decide deliberately before submitting another adjustment. Archive hides books and rejects new checkout lines while preserving earlier order snapshots; restore uses the same book ID. Low stock means five or fewer units.

The Activity API records successful catalog changes, role changes, another-user password resets, and order status changes in the same transaction as the business write. Cancellation also records each restored book stock change. `adminActivity` is Admin-only; Staff changes are attributed but Staff cannot read history. It has a default limit of 20, maximum 50, newest-first ordering, and actor/action/changed-field/target/UTC-range filters. The log starts after the updated backend runs with `0005_panoramic_invisible_woman` applied; prior changes are not backfilled. The operator command records an `OPERATOR` event named **Operator command**, never an inferred person.

`workspaceDashboard` is available to Staff and Admin only when both `VIEW_ORDERS`
and `MANAGE_CATALOG` apply. `adminDashboardFinance` is Admin-only through
`VIEW_DASHBOARD_FINANCE`. It returns read-only, bounded operational previews and
7/30/90-day exact-cent payment/refund summaries in fixed `Asia/Dubai` calendar days.
The dashboard adds no migration, provider call, reporting table, or environment
variable; see [the dashboard specification](specs/dashboard/SPEC.md) for fields,
eligibility, and payment semantics.

Before migrating persisted data, stop writers and make a consistent SQLite backup (including any required WAL state, or use SQLite's backup API). The staff-role migration copies old admin memberships as Admin and drops the old table. Activity migration `0005_panoramic_invisible_woman` is additive and preserves existing data; an earlier compatible binary may ignore its table but will not record events. Preserve the table and document any resulting history gap, or restore the matching pre-migration backup with compatible application versions. The test suites use isolated databases and do not grant development/production access.

See [the admin spec](specs/admin/SPEC.md) for the full contract.

## Migration workflow

For SQLite changes, edit `src/database/schema.ts`, run `bun run db:generate`, and review and commit generated SQL and metadata in `drizzle/`. For PostgreSQL changes, update the matching definitions in `src/database/postgresql/`, use `drizzle.postgresql.config.ts`, and commit the generated PostgreSQL SQL/snapshots under `drizzle/postgresql/`. Every logical schema change needs reviewed migrations for both providers. Better Auth table updates begin with `auth.cli.ts` and its generated schemas. Apply migrations with `bun run db:migrate`: it retains SQLite's legacy-aware wrapper and applies PostgreSQL migrations explicitly. PostgreSQL startup only checks readiness; it never applies migrations.

The SQLite wrapper verifies the original `user_version = 1` schema and foreign keys before recording the matching Drizzle baseline. Fresh and zero-order pre-workflow SQLite databases migrate normally. A populated pre-workflow orders table without `status` fails before migration writes; use an explicitly authorized development reset/reseed or a separately designed data migration rather than fabricating status history. It never resets a database automatically. Unsupported SQLite legacy schemas or versions fail startup. Keep both `drizzle/` and `drizzle/postgresql/` beside the built application when deploying. Back up a persistent target before applying schema changes.

## Checks

```powershell
bun run test
bun run test:postgres
bun run lint
bun run build
```

After changing a module GraphQL schema, run `bun run codegen` here to refresh the committed resolver types. If a frontend operation uses the new schema, start the API and run `bun run codegen` in the frontend repository too.

`bun run test` uses in-memory SQLite. `bun run test:postgres` provisions a disposable
local PostgreSQL 17.10 instance and runs the shared parity suite. New orders use Stripe hosted Checkout
in test mode with a required delivery address and reviewed fee-inclusive total. Email verification and self-service password
recovery are implemented through Better Auth and configured SMTP. Captured-mail tests
prove the flow, but live Ethereal/Brevo inbox delivery has not been exercised. An admin can
still set another account's password. Before a live
launch, specify and implement live-payment, fulfillment, customer communication,
monitoring, and deployment controls.

## Proposed production email notifications

[Production email notifications](specs/email-notifications/SPEC.md) and its
[implementation plan](docs/superpowers/plans/2026-10-16-production-email-notifications.md)
propose a durable outbox, Redis/BullMQ auth and order queues, and a separate email
worker reusing verification and password-reset mail. This is documentation only;
current runtime delivery remains unchanged.
