# The Quiet Shelf API

An Express + GraphQL + Drizzle + SQLite bookstore API with Zod input validation. This folder is its own Git repository and runs independently from the frontend.

See [SPEC.md](SPEC.md) for the implemented API behavior and [specs/authentication/SPEC.md](specs/authentication/SPEC.md) for the account feature contract.

## Development workflow

Future behavior changes follow spec-driven development (SDD) and test-driven development (TDD). Write or revise the relevant spec before implementation, with a proposed contract and testable acceptance criteria. For each criterion, write a focused failing test, confirm the failure is caused by the missing behavior, make it pass, and refactor. Finish with the checks below and coordinate frontend tests for contract changes; then update the spec to reflect the delivered behavior and mark a feature spec `Implemented`. See [AGENTS.md](AGENTS.md) for the full workflow and cross-repository rules.

## Start

Requires Bun 1.3.14 for package management and Node.js 24 or later for runtime and tooling. Each repository commits its own `bun.lock`; use `bun install` when changing dependencies.

```powershell
bun install --frozen-lockfile
Copy-Item .env.example .env
# Set BETTER_AUTH_SECRET in .env to a random secret of at least 32 characters.
bun run dev
```

The backend's `bunfig.toml` disables dependency install scripts. Its SQLite driver ships native binaries; this avoids an unnecessary local `node-gyp` rebuild on Windows. Revisit this setting when adding a dependency that requires an install script.

The API starts at `http://localhost:4000/graphql`; Better Auth serves `/api/auth/*`, and `GET /health` returns a health response. SQLite migrations run on startup. Development seeds twelve catalog books once; production does not seed automatically. Use `bun run db:seed` only when you intentionally want the sample catalog. The `data/` directory is ignored by Git. Configure `PORT`, `DATABASE_PATH`, `FRONTEND_ORIGIN`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, and `NODE_ENV` in `.env`. Set `BETTER_AUTH_URL` to the public storefront origin that proxies `/api/auth` (localhost:5173 in development). The secret must be random and at least 32 characters; do not use the schema generator's test secret in a running server.

Auth request bodies are capped at 64 KiB. Sign-up and account updates trim names and enforce 1–120 characters. Rate limiting uses the direct socket address by default and ignores caller-supplied forwarding headers. Behind a reverse proxy, set `AUTH_TRUSTED_PROXY_IP` to its peer IP only when that proxy **overwrites** `X-Real-IP` and direct access to the API is blocked. Without this setting, customers behind the proxy share one rate-limit bucket.

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
mutation RequestBooks {
  placeOrder(input: { items: [{ bookId: "1", quantity: 1 }] }) {
    id
    totalCents
    items {
      title
      quantity
      unitPriceCents
    }
  }
}
```

The order mutation requires a Better Auth session. It uses the session user's name and email, validates the lines, reads current prices, checks stock, and saves the order and stock changes in one SQLite transaction. The browser never supplies an order total or user ID. `myOrders(limit, offset)` returns only the signed-in user's requests. The GraphQL endpoint is the catalog and order API; Better Auth handles account requests under `/api/auth/*`.

## Architecture

GraphQL resolvers play the **controller** role in MVC: they receive API requests and translate application errors into GraphQL errors. Services validate input through module-local Zod schemas and enforce business rules. Repositories contain Drizzle queries. Validation failures retain the GraphQL `BAD_USER_INPUT` code. The React repository contains the views.

```text
src/
  app.ts                 Express and Apollo setup
  server.ts              Process startup and shutdown
  config/env.ts          Environment validation
  database/
    connection.ts        SQLite connection
    schema.ts            Storefront tables and SQLite constraints
    auth-schema.ts       Better Auth tables generated for Drizzle
    migrations.ts        Drizzle migrations and legacy adoption
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
  shared/errors.ts       Application validation error
test/                     API and database integration tests
drizzle/                  Committed SQL migrations and metadata
```

## Admin access and operations

The existing storefront includes `/admin` for authorized store staff. It manages books, atomic stock adjustments, archive/restore, and read-only order requests. There are two roles: Customer and Admin. All accounts start as customers; an `admin_memberships` row grants admin abilities while retaining normal customer access. Seller accounts are not part of this single-bookstore application.

Start the API to apply migrations, or run `bun run db:migrate` using the configured `.env`. Register the intended account through the storefront, verify the account identity, and obtain its exact user ID from the signed-in `viewer { id role }` GraphQL query or the local database. Run these operator commands **from this backend directory**, against the intended `DATABASE_PATH`:

```powershell
bun run admin:access -- grant <user-id>
bun run admin:access -- revoke <user-id>
```

Both commands are idempotent and reject unknown users. They do not create accounts, passwords, or public promotion endpoints. Membership is checked on each admin API request, so revocation affects the next request even with an existing session. Reload or focus the storefront to refresh its navigation/access display after a grant.

Metadata edits exclude stock; inventory changes are signed deltas applied to current stored stock. A lost mutation response leaves the result uncertain: check inventory and decide deliberately before submitting another adjustment. Archive hides books and rejects new checkout lines while preserving earlier order snapshots; restore uses the same book ID. Low stock means five or fewer units.

Before migrating persisted data, stop writers and make a consistent SQLite backup (including any required WAL state, or use SQLite's backup API). To roll back, stop writers and restore the backup with its matching application release. An older API ignores the archive flag and must not serve an upgraded database as a rollback method. The test suites use isolated databases and do not grant development/production access.

See [the admin spec](specs/admin/SPEC.md) for the full contract.

## Migration workflow

Edit `src/database/schema.ts`, then run `bun run db:generate` and review and commit the generated SQL and metadata in `drizzle/`. Better Auth table updates begin with `auth.cli.ts` and the Better Auth schema generator; review `src/database/auth-schema.ts` before generating a Drizzle migration. Apply migrations with `bun run db:migrate`; startup uses the same wrapper. Drizzle Kit is configured in `drizzle.config.ts`.

The wrapper verifies the original `user_version = 1` schema and foreign keys before recording the matching Drizzle baseline, preserving catalog and order data. Fresh databases run the baseline normally. Unsupported legacy schemas or versions fail startup. Keep `drizzle/` beside the built application when deploying. Use the wrapper for existing databases: direct `drizzle-kit migrate` bypasses legacy adoption. Back up database files before applying schema changes.

## Checks

```powershell
bun run test
bun run lint
bun run build
```

After changing a module GraphQL schema, run `bun run codegen` here to refresh the committed resolver types. If a frontend operation uses the new schema, start the API and run `bun run codegen` in the frontend repository too.

Tests run against an in-memory SQLite database. This API records **order requests** without payment or delivery. Email verification and password recovery are deferred. Before serving real customer accounts or accepting real orders, add those email flows, payment or fulfillment, customer communication, operational monitoring, and deployment specific security controls.
