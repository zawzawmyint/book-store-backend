# The Quiet Shelf API — SQLite development and PostgreSQL production

> **Status:** Implemented. **Date:** 2026-10-08. SQLite is the development/test default and PostgreSQL is supported for production.

## Goal

Run the same API and business workflows with SQLite for normal local development
and PostgreSQL for production. Once both adapters are implemented and verified,
choose the database through configuration without modifying services or frontend code.

**Agreed portability requirement:** after both providers are supported, switching
between SQLite and PostgreSQL requires only environment configuration, applying
the selected provider's existing migrations, and restarting. It must not require
editing query source, changing repository callers or rebuilding provider-specific
application variants. Separate schemas/migrations and necessary adapter internals
remain database-specific; switching does not transfer data.

Keep [delivery](../delivery/SPEC.md) as a separate feature. Establish this database
boundary before implementing its workflow; the delivery feature must then work
against both providers. Database support itself does not introduce delivery states,
change checkout contracts or enable live Stripe payments.

## Scope and decisions

Include provider selection, connections/lifecycle, dialect-specific Drizzle schemas
and migrations, async repository contracts, transaction safety, Better Auth,
catalog/order/payment/Activity/account parity, operational commands and dual-provider tests.

Exclude copying/synchronizing data between engines, switching an active process
without restart, read replicas, sharding, distributed caching, a new ORM, hosting
provisioning, email delivery and live-payment activation. Selecting a different
database uses that database's data; it does not migrate users/orders automatically.

Use Drizzle with `better-sqlite3` for SQLite and `pg` with
`drizzle-orm/node-postgres` for PostgreSQL. Node.js 24+ and Bun 1.3.14 remain required.

## Delivered architecture

- `openDatabase(config)` creates a SQLite handle or a PostgreSQL pool/Drizzle handle and
  exposes an awaited close operation. PostgreSQL startup verifies its migration journal
  and required relations before the HTTP server or payment worker starts.
- SQLite schema and legacy-aware migration history remain in `src/database/` and
  `drizzle/`; PostgreSQL schema and Better Auth definitions live in
  `src/database/postgresql/`, with its independent baseline under `drizzle/postgresql/`.
- Repositories accept provider-neutral, promise-returning business-operation interfaces.
  Services, resolvers, permission checks, workers, auth, seeds, and operator commands
  await those interfaces. `src/database/persistence.ts` selects the adapter at the
  composition boundary.
- Shared validation, DTOs, query helpers, and business operations remain common. SQLite
  serialization/immediate transactions and PostgreSQL row/advisory locks, leases and
  migrations stay inside their adapters.

## Configuration contract

Variables validated in `src/config/env.ts` before opening any connection:

- `DB_PROVIDER`: `sqlite` or `postgresql`. When absent, development/test selects
  SQLite; production selects PostgreSQL. Unknown values fail startup.
- `DATABASE_PATH`: SQLite only, default `./data/book-store.sqlite`; tests may use
  `:memory:`. Reject blank paths. Never create directories for a PostgreSQL URL.
- `DATABASE_URL`: required for PostgreSQL; accept a nonempty `postgresql://` or
  `postgres://` URL with a host and database name. Never print credentials.
- `PG_POOL_MAX`: positive integer, default 10; cap at 100. Document that each
  process has its own pool and total connections must fit the server's limit.
- `PG_TLS_MODE`: `verify-full` or `disable`. Default verify-full in production,
  disable in development/test. `PG_CA_FILE` optionally names a trusted CA bundle.
  In verify-full mode verify the certificate chain and hostname; do not use
  `rejectUnauthorized:false`. Reject contradictory URL/TLS settings rather than
  silently overriding them. Production cannot select disabled TLS.

Production must use PostgreSQL: explicitly selecting SQLite in production fails
before opening files or serving requests. Development/test can explicitly select
PostgreSQL for parity testing. Unused connection settings are not used as fallback;
a failed PostgreSQL connection never opens SQLite instead.

Example configuration:

```dotenv
# Normal development
NODE_ENV=development
DB_PROVIDER=sqlite
DATABASE_PATH=./data/book-store.sqlite
```

```dotenv
# Production; substitute real connection details and secret management
NODE_ENV=production
DB_PROVIDER=postgresql
DATABASE_URL=postgresql://app_user:REPLACE_ME@db.example.com:5432/book_store
PG_TLS_MODE=verify-full
PG_POOL_MAX=10
```

Production origins/auth secrets retain existing validation. PostgreSQL support
alone does not satisfy the separate requirements for real accounts/live payments.

## Application and repository boundary

- One composition root selects a provider-specific runtime with a database handle and
  awaited close operation. `openDatabase(config)` also performs provider connection and
  readiness work. App composition creates repositories and the Better Auth adapter from
  that selected handle; SQL handles and Drizzle dialect types stay out of services,
  resolvers, and migration callers.
- Business services accept narrow repository interfaces rather than
  `Database.Database` or a SQLite/PostgreSQL union. Repository operations return
  promises on both providers; SQLite may wrap synchronous work internally.
  Await all calls in services, resolvers, permission guards, CLI and workers.
- Keep validation, price rules, allowed order transitions, payment-provider work,
  authorization policy and DTO formatting shared. Dialect-specific SQL belongs
  inside provider adapters. Prefer shared portable Drizzle query logic over two
  full copies of each repository. Reuse query helpers where their type/behavior
  is truly portable; do not duplicate business rules or build a generic CRUD DSL.
- Repository interfaces describe business operations, including atomic reservation,
  status change, stock adjustment, role changes and payment operation claiming.
  Do not split these into unrelated saves that lose their transaction boundary.
- Transaction-scoped repositories must use the same SQLite connection or checked-out
  PostgreSQL client. Never dispatch part of a transaction through the general pool.
  Reuse the existing Activity writer through that transaction scope.
- Normalize responses at adapter boundaries: string IDs, bounded integer cents and
  quantities, existing UTC timestamp format, booleans, null handling and pagination.
  GraphQL does not expose pg Date objects, bigint values or database error messages.
- Translate unique/check/concurrency failures into the same existing application
  errors. Preserve UNAUTHENTICATED/FORBIDDEN/BAD_USER_INPUT/CONFLICT and safe
  provider-unavailable behavior. Database failures must not bypass owner/role checks.

## Portable queries and dialect isolation

- Use Drizzle's query builder for ordinary selects, inserts, updates, deletes,
  joins, filters, ordering and pagination wherever it can preserve the contract.
  Avoid raw SQL that exists only because the initial implementation used SQLite.
- Share common query construction and result mapping where supported by both
  dialects. Keep the same business-operation interface regardless of how much
  implementation can be shared. Drizzle's dialect-specific table/query types
  are not interchangeable; do not force sharing with unsafe casts or weaken type
  checking to make one query appear portable.
- No database-provider checks, raw dialect SQL, SQLite driver types, SQLite query
  execution methods, pragmas or locking syntax in business services/resolvers.
  Select adapters at composition time, rather than scattering DB_PROVIDER checks
  across application workflows. Domain errors and GraphQL DTOs are provider-neutral.
- Move `.get()`, `.all()`, `.run()` and `.immediate()` dependencies into the SQLite
  adapter. PostgreSQL executes the corresponding operation asynchronously; shared
  callers use the same promise-returning methods. Prefer conditional Drizzle
  updates with affected-row checks for stock/state changes on both providers.
- Isolate genuinely necessary differences: case-insensitive search/escaping,
  timestamp expressions, identity/returning behavior, transaction setup, row locks,
  operation leases and database error normalization. SQLite metadata inspection
  and pragmas belong exclusively to its connection/migration implementation.
- Raw SQL is allowed only inside an adapter or dialect-specific migration when
  needed for correctness or a capability Drizzle cannot express. Parameterize
  values, document the reason and equivalent behavior on the other provider, and
  cover that behavior in the shared contract tests. A difference must not require
  developers to change queries when selecting another supported database.
- Separate physical schemas and migration SQL are expected. Preserve identical
  logical fields, constraints and API behavior, rather than requiring identical
  database syntax. Better Auth also receives its selected adapter at startup.
- Implement only the SQLite/PostgreSQL support required here; no generic plugin
  architecture or adapters for hypothetical future database engines.

## Atomicity and concurrency

- Stock validation, reservation, order/line snapshots, initial history, checkout
  request mapping and payment operation creation commit or roll back together.
- SQLite retains immediate write transactions where required. PostgreSQL uses
  conditional updates or row locks with affected-row checks; do not rely on a
  read-then-write stock check under default isolation. Lock multiple book rows
  in a deterministic ID order to reduce deadlocks.
- `(userId, requestKey)` is unique on both engines. Concurrent matching requests
  reuse the one saved order; differing payloads conflict. Handle unique-key races
  after rollback/re-read without repeating stock deductions.
- Status transitions compare expected stored state inside the write transaction.
  Concurrent cancellation/dispatch cannot both succeed. Stock restoration, history,
  Activity and refund-operation enqueueing remain once per real transition.
- Webhook event IDs, provider associations and payment operation IDs retain unique
  constraints. Repeated/out-of-order provider evidence cannot duplicate payment,
  refunds, stock writes or timelines.
- Worker claims use durable atomic leases with expiry and retry state. Concurrent
  processes must not both claim an unexpired operation; completion must validate
  lease ownership so a stale worker cannot overwrite another worker's result.
- Provider network calls remain outside transactions on either engine. Uncertain
  Stripe operations recover with existing provider idempotency keys, never a new
  charge/refund merely because a database/network call failed.
- Keep transactions short. PostgreSQL uses a 10-second connection timeout and a
  30-second statement timeout; report bounded failure instead of indefinite
  checkout hangs. Do not automatically retry external payment side effects.

## Schema, migrations and authentication

- Maintain two physical Drizzle schemas for the same logical data contract:
  SQLite and PostgreSQL definitions, including Better Auth
  tables. Share application types/constants, not incompatible Drizzle table objects.
- Preserve existing SQLite migration files/history. PostgreSQL schema
  sources live under `src/database/postgresql/`; PostgreSQL SQL/snapshots/journal
  live under `drizzle/postgresql/`. Configure SQLite migration discovery to exclude
  that directory; never apply one dialect's SQL to the other database.
- Use provider-specific Drizzle Kit configuration; every schema change generates
  and reviews migrations for both providers. No hand-edited generated resolver types
  or invented translations of SQLite SQL.
- PostgreSQL starts with a reviewed baseline representing the model
  at the time database support is delivered. Subsequent delivery changes add their
  own paired migrations. Keep current behavior and proposed delivery distinct.
- Adapt identity columns, integer bounds, boolean/timestamp representation, foreign
  keys, indexes and checks intentionally. Test escaped literal `%`/`_` search,
  case handling, stable sorting and pagination against the existing contract.
- Preserve SQLite's supported legacy-adoption guards; do not apply those to
  PostgreSQL or fabricate historical order state. Delivery's deliberate fresh-data
  policy is defined in its own spec and supersedes preserving local orders for
  that feature, not production safety rules.
- Select the correct Better Auth Drizzle provider/schema and verify sign-up,
  sessions, password updates, revocation, role lookup and owner identity on both
  databases. Adapt `auth.cli.ts` generation per dialect without touching live data.
- Do not rebuild or reset schemas at startup. `bun run db:migrate` applies only
  the configured provider's reviewed migrations. SQLite development/test may
  retain automatic migrations for convenience; PostgreSQL migration is explicit,
  followed by an app startup check that the expected schema is present.

## Startup, shutdown and operational commands

- Preserve existing `bun run dev`, `build`, `start`, `db:generate`, `db:migrate`,
  `db:seed`, `demo:seed` and `admin:access` entry points, dispatching by validated
  provider. Document PostgreSQL prerequisites and connection configuration.
- SQLite development retains current sample-catalog initialization. PostgreSQL
  never auto-seeds on startup; explicit catalog/demo seeding in development/test
  uses equivalent rules. Both catalog and demo seed commands reject production before
  connecting.
  Existing explicit operator/catalog commands retain their authorization/scope.
- Await database connection and schema checks before listening or starting the
  payment worker. On partial startup failure, close acquired connections/pools.
  `/health` remains the existing liveness response; no new public database detail.
- Shutdown stops accepting requests, waits for current requests and recovery work,
  then awaits SQLite close or pg pool end. Release transaction clients in finally
  blocks on success, rollback and errors.
- This spec does not authorize production reset/seed or remote data deletion.
  The previously approved local fresh-data reset belongs to delivery implementation.

## Tests and acceptance criteria

`bun run test:postgres` runs the shared repository/service/API integration suite
against a dedicated disposable PostgreSQL 17.10 database; `bun run test` remains the
default SQLite suite. `bun run test:postgres:browser` provisions the same isolated
database for the frontend's browser suite. These commands create an embedded local
PostgreSQL cluster and reject targets outside their UUID-named loopback test database.
They do not silently skip unavailable PostgreSQL. If Bun reports an embedded
PostgreSQL platform setup script as blocked, trust the appropriate platform package
with `bun pm trust @embedded-postgres/windows-x64` or
`bun pm trust @embedded-postgres/linux-x64` and reinstall as directed by Bun. Windows
x64 support was verified with the pinned `embedded-postgres` 17.10.0-beta.17 package;
Linux platform support has not been verified by this change.

- [x] Development defaults to SQLite; production requires PostgreSQL with valid TLS.
- [x] Explicit PostgreSQL development/testing works; connection failure has no fallback.
- [x] The same API/services run without SQLite driver types or dialect branches.
- [x] The same application build starts against either provider through configuration;
      switching needs no query edits or provider-specific source/build changes.
- [x] Ordinary queries prefer portable Drizzle construction; necessary dialect SQL
      and execution/locking differences are isolated and explained in adapters.
- [x] Shared business operations, validation and DTO mapping are not duplicated
      into complete SQLite and PostgreSQL backend implementations.
- [x] Both fresh migration chains produce equivalent logical constraints and data.
- [x] Auth, permissions, account flows, catalog/search, pagination and Activity match.
- [x] Concurrent checkout for the final stock unit never oversells on either provider.
- [x] Concurrent same-key checkout creates one order/reservation/provider operation.
- [x] Concurrent status changes, cancellation and worker claims preserve atomicity.
- [x] Fault injection rolls back order, stock, history and Activity together.
- [x] Duplicate webhook/payment/refund retries have identical safe results.
- [x] PostgreSQL pool/client cleanup works after startup, transaction and shutdown failures.
- [x] Provider-specific schema generation/migration and explicit seed/operator commands work.
- [x] Both integration suites, lint/build and frontend browser journeys pass.
- [x] README, `.env.example`, root/spec/auth/payment docs and repository guidance
      describe verified delivered behavior before this spec becomes Implemented.

The completed verification included 31 backend test files / 163 tests on SQLite,
the shared 10-case PostgreSQL parity suite, compiled-application smoke checks with
each provider, explicit PostgreSQL migration/readiness checks, and migration, catalog
seed, demo seed, and operator grant/revoke command checks. Frontend verification ran
26 files / 105 tests, lint and build, plus 33 Playwright journeys against both SQLite
and PostgreSQL. The PostgreSQL contract suite opens independent connections for stock,
idempotency, status, and worker-lease races; it also checks Activity rollback.

## Affected files and delivery sequencing

Existing files: `src/config/env.ts`, `src/database/connection.ts`, `migrations.ts`,
schemas/seed/CLI files in `src/database/`, `drizzle.config.ts`, `src/auth.ts`,
`auth.cli.ts`, `src/app.ts`, `src/server.ts`, GraphQL resolver composition,
repository/service/permission/Activity units under `src/modules/`, `test/`,
`package.json`, `bun.lock`, `.env.example`, README and specifications.

Provider runtime/contracts now live in `src/database/runtime.ts`,
`persistence.ts`, `store.types.ts`, and `query.helpers.ts`. PostgreSQL schema,
connection/migration, and adapter code live in `src/database/postgresql/`; SQLite
adapter code lives in `src/database/sqlite/`. Module repositories call the shared
business-operation contract and do not take a provider-specific driver type.

Deliver database runtime/migrations, then async auth/repository/service integration,
then dual-provider concurrency/parity checks. Implement delivery afterward against
those contracts. The storefront uses the same GraphQL endpoint; adapt its test
server setup as needed without adding database-specific UI behavior.

## Rollout and open decisions

Switching environments is a process restart with another configured database after
its migrations have been applied. Application changes made while supporting both
providers must update both migration sets and pass both parity suites.

For initial production use, target an empty PostgreSQL database. Existing SQLite
data transfer is out of scope and would require an explicit export/import spec.
Back up any persistent target before schema changes; rollback uses compatible app
versions/migrations or a deliberate backup restoration, never automatic destructive
fallback. Database support does not by itself make the application production-ready.

The automated portable-test baseline is PostgreSQL 17.10 through the pinned
`embedded-postgres` package. Production hosting, PostgreSQL server maintenance, and
credentials remain deployment choices; this feature creates no external database.
