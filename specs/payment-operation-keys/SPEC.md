# Payment operation keys

> **Status:** Implemented. **Date:** 2026-10-08.

New checkout and refund operations must use `checkout:<UUID>` and `refund:<UUID>`
operation IDs, persisted atomically before Stripe calls. Retries and restarts reuse
the saved ID; order IDs and refund counts are not provider idempotency identities.
Checkout reconciliation reads the saved CREATE_SESSION operation by order ID through
the shared store and both Drizzle adapters. No GraphQL or schema change is required.
Existing operation IDs remain valid and are never automatically rotated.

- [x] Independent fresh databases reusing order IDs produce distinct checkout/refund keys.
- [x] Lost provider responses and restart recovery reuse the same saved keys.
- [x] Historical deterministic IDs remain recoverable without replacement.
- [x] SQLite and real PostgreSQL use the same behavior; backend tests (188 across 34 files), lint, build, and 20 PostgreSQL parity checks pass.

The known local `checkout:1` collision was repaired under a narrow, verified recovery
procedure. Stripe first returned an exact saved-request `StripeIdempotencyError` (HTTP
400); there was no attached Checkout Session, PaymentIntent, cancellation, charge, or
refund. After stopping API writers and taking a consistent SQLite backup outside Git,
one guarded immediate transaction changed only the checkout operation ID and its
retry/lease state, and renewed the local payment expiry to Stripe's required window.
The order snapshot was then unchanged except for expiry. On restart, the worker created
the Checkout Session and marked the operation DONE. A read-only Stripe retrieval
confirmed an open, unpaid test-mode USD Session for 3098 cents, matching the saved
order; no payment, charge, or refund was performed. Targeted checkout/order-workflow
browser coverage passed 6/6.

This exceptional repair does not permit automatic key rotation: uncertain timeouts keep
their original keys, and normal operation never deletes Stripe resources or resets a
database.
