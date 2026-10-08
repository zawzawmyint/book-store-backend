# The Quiet Shelf API — authentication and authorization specification

> **Status:** Implemented. Email verification and password recovery remain deferred.

## Goal

Require a Better Auth session for order requests and expose each customer's own order history. Keep the public book catalog and existing order pricing and stock rules. The matching storefront requirements are in [the frontend auth spec](../../../frontend/specs/authentication/SPEC.md).

## Starting point

- This repository is an Express 5, Apollo GraphQL, Drizzle, and Zod API. SQLite is
  the development/test default and PostgreSQL is supported for production. Bun manages
  dependencies; Node.js runs the API.
- Before this feature, `placeOrder` accepted a guest name and email, and `orders` had no user reference. This historical compatibility note applies to the authentication migration; the later order workflow refuses a populated pre-workflow order table rather than preserving or inventing workflow state.
- SQLite's `src/database/migrations.ts` adopts verified legacy databases and applies
  committed SQLite migrations. PostgreSQL has a separate baseline/migration chain.
  Order creation and stock updates share one provider-scoped transaction.

## Scope

- Enable Better Auth email-and-password sign-up, sign-in, sign-out, and persistent browser sessions. Successful sign-up establishes a session immediately. **Email verification is not required** in this release.
- Require a valid session for `createCheckout`, `myOrders`, and owner-scoped `myOrder`. Leave catalog queries and `/health` public. Deprecated `placeOrder` cannot create an unpaid order.
- Store order ownership by Better Auth user ID. Do not assign historical guest orders to accounts; the later workflow migration requires fresh or zero-order data as documented in [the order-workflow specification](../order-workflow/SPEC.md).
- Defer email verification, password reset and other email flows, social login, guest checkout, claiming past orders, and shipping. Stripe hosted test payment is delivered by [the checkout specification](../stripe-checkout/SPEC.md). Admin roles, originally outside this account feature, are now delivered by [the admin feature](../admin/SPEC.md).

## HTTP and GraphQL contract

- Better Auth owns `GET/POST /api/auth/*`. Mount its Express 5 catch-all route at `/api/auth/*splat` before `express.json()`; keep `/graphql` and `/health` separate.
- Create the Better Auth instance from the same selected database runtime used by Apollo,
  including the SQLite in-memory API tests and PostgreSQL parity tests. Resolve the
  server session from incoming request headers in Apollo context. The browser never
  supplies an authoritative user ID, name, or email.
- **Breaking change:** `PlaceOrderInput` becomes `{ items: [OrderItemInput!]! }`; remove `customerName` and `email`. `placeOrder` reads `user.id`, `user.name`, and `user.email` from the server session. It rejects a missing or expired session with GraphQL `extensions.code: UNAUTHENTICATED` before writing an order or changing stock.
- Preserve order line validation, `BAD_USER_INPUT` for invalid inputs, stored-price totals, stock checks, and transactional writes. Keep the existing receipt fields.
- Add `myOrders(limit: Int = 20, offset: Int = 0): MyOrdersPage!` to `Query`. Validate `limit` from 1 to 50 and nonnegative `offset`. Entries include `id`, `createdAt`, `status`, `totalCents`, and saved lines. List newest first and filter by the session user ID in the repository. `myOrder(id)` uses the same owner scope and returns the customer-safe status timeline. Reject missing or expired sessions with `UNAUTHENTICATED`.
- Do not provide order lookup or account claiming by email. No client argument can select a different user's orders; a valid non-owned detail ID returns null without disclosing it.
- Regenerate `src/graphql/generated/resolvers.ts` after schema changes. The changed mutation input requires a coordinated frontend release.

## Data and migration

- Better Auth's required `user`, `session`, `account`, and `verification` tables have
  matching SQLite and PostgreSQL Drizzle definitions. Generate/review both provider
  schemas and migration sets when auth persistence changes. SQLite uses the repository's
  legacy-aware migration wrapper; PostgreSQL uses its explicit `db:migrate` path.
- Add nullable `orders.user_id` referencing `user.id`, plus an index supporting user-scoped newest-first listing. Keep `orders.customer_name` and `orders.email` as contact snapshots populated from the server session for new orders.
- Existing orders receive `user_id = NULL`. Do not backfill by matching email; a new account does not prove ownership of an earlier guest request.
- These statements describe the historical authentication migration. The later workflow migration supports fresh or zero-order databases and blocks populated pre-workflow orders before writing; review that guard before planning a data-preserving migration.

## Configuration and security

- Validate `BETTER_AUTH_SECRET` (high entropy and at least 32 characters) and `BETTER_AUTH_URL` in `src/config/env.ts`; document them in `.env.example`. Never expose the secret to the frontend.
- Configure Better Auth `trustedOrigins` for the exact `FRONTEND_ORIGIN`. Allow credential-aware CORS only for that origin when direct cross-origin requests are necessary. Prefer a same-origin proxy for `/api/auth` and `/graphql`; production sessions use secure, HTTP-only cookies over HTTPS.
- Keep Better Auth rate limiting enabled in production. Trust forwarded IP headers only when a deployment proxy is configured to overwrite or sanitize them.
- Limit `/api/auth/*` request bodies to 64 KiB. Validate and trim the account name to 1–120 characters on both sign-up and update. Use the socket IP for rate limiting unless `AUTH_TRUSTED_PROXY_IP` identifies a proxy that overwrites `X-Real-IP` and blocks direct API access.
- Accept the authenticated GraphQL order mutation only from the configured storefront origin and with a JSON request. Enforce authorization in the resolver regardless of frontend route guards.
- Do not treat an unverified email as verified. An email sender, verification, and recovery are a later release and are required before serving real customer accounts in production.

## Files affected

- `src/app.ts`, `src/config/env.ts`, `src/database/schema.ts`, `src/graphql/resolvers.ts`, `src/modules/orders/`, `drizzle/`, `.env.example`, generated resolver types, API and migration tests, `SPEC.md`, `package.json`, and `bun.lock`.

## Acceptance criteria

- Sign-up, sign-in, session restoration, and sign-out work against the same selected database as orders.
- Direct unauthenticated or expired-session calls to `createCheckout`, `myOrders`, and `myOrder` return `UNAUTHENTICATED`; no order or stock change occurs.
- A signed-in order uses the session user ID and contact details and appears only in that user's history. Another account and a signed-out request cannot read it.
- The historical authentication migration leaves guest orders unclaimed. The later workflow migration blocks populated pre-workflow orders; an explicit development reset or separately designed data migration is required for them.
- Invalid lines still return `BAD_USER_INPUT`; failed orders remain atomic.
- Backend tests, lint, and build pass. The matching frontend's browser suite covers the complete account and checkout flow.

## References

- [Better Auth installation](https://better-auth.com/docs/installation)
- [Express integration](https://better-auth.com/docs/integrations/express)
- [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle)
- [Session management](https://better-auth.com/docs/concepts/session-management)
