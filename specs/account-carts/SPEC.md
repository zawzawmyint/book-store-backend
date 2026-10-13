# Account carts — API specification

> **Goal:** Save a separate shopping cart for each account, merge local guest selections safely, and preserve account isolation through checkout.

**Status:** Implemented

**Date:** 2026-10-13

## Context and scope

Before the account-cart cutover, the storefront persisted one raw cart array under
`book-store-cart`; the API had no saved-cart contract. Account changes cleared private
Apollo data and checkout attempts while preserving that shared cart. Checkout already
validated book IDs, quantities, prices, stock, delivery, and verified session ownership.

The delivered implementation adds one active server cart per account for Customer,
Staff, and Admin. Guest carts remain browser-local. The matching [frontend specification](../../../frontend/specs/account-carts/SPEC.md) defines display, merging, and session transitions.

Excluded: server guest sessions, live cart push/WebSockets, offline account editing, abandoned-cart messaging, wishlists, new payment providers, and the unrelated duplicate access-denied header.

## Delivered contract

1. Guest selections stay local and do not call a cart API.
2. A verified sign-in loads that account's cart and optionally merges the guest snapshot once.
3. Each authenticated add, quantity change, or removal is saved immediately. Browser state is a view of the server cart, not its authority.
4. Logout hides the account cart without deleting it. Signing into another account loads only that account's cart.
5. Other devices load the same saved cart on sign-in, page entry, or refresh. Revalidate on window focus; continuous live synchronization is out of scope.
6. Saving a cart neither reserves stock nor locks prices. Existing checkout remains authoritative.

## GraphQL contract

The following fields are composed into `POST /graphql` and are implemented source
contracts.

- `myCart: AccountCart!` returns the verified session owner's cart. A missing cart reads as revision `"0"` with no items; a read need not create a database row.
- `setCartItem(input: SetCartItemInput!): AccountCart!` sets one book's absolute quantity; zero removes it.
- `mergeGuestCart(input: MergeGuestCartInput!): AccountCart!` atomically merges a bounded guest snapshot.
- `AccountCart = { revision: String!, items: [AccountCartItem!]! }`.
- `AccountCartItem = { bookId: ID!, quantity: Int!, lineVersion: String!, title: String!, author: String!, genre: String!, priceCents: Int!, stock: Int!, available: Boolean! }`.
- `SetCartItemInput = { bookId: ID!, quantity: Int!, expectedRevision: String!, requestKey: String! }`.
- `MergeGuestCartInput = { items: [OrderItemInput!]!, expectedRevision: String!, requestKey: String! }`.

Revisions are nonnegative decimal strings to avoid GraphQL Int overflow; line versions are opaque, server-created identities. Every successful state change increments the cart revision. Changing or removing/re-adding a line changes its version, even when its quantity returns to the original value.

## Authorization and validation

- Derive the owner from the existing verified session; never accept `userId`, role, owner, or trusted prices from a client. Staff/Admin permissions do not grant access to another person's cart.
- `X-Cart-Account` is an optional browser expectation header used to detect a stale
  client session. When present it must match the verified session owner; it never
  selects an owner or overrides server session authorization.
- Preserve credentialed same-origin GraphQL, JSON, origin checks, and existing authentication errors. Guests/unverified sessions receive `UNAUTHENTICATED` before cart reads or writes.
- Accept numeric book IDs using existing validation, UUID request keys, at most **20 distinct lines**, and integer quantities **1–10**; only `setCartItem` accepts zero. Empty guest merges are client no-ops; duplicate guest IDs or invalid input return `BAD_USER_INPUT` without partial writes.
- Reject new/increased quantities for missing, archived, or insufficient-stock books. Allow removal/decreasing of an existing unavailable line so shoppers can repair the cart.
- Project current catalog metadata on reads. Existing archived/out-of-stock lines remain visible with `available: false`; do not silently delete them. `available` means the book is active and has stock for the saved quantity. Totals are estimates computed from current prices, not historical promises.
- No addresses, payment information, credentials, or account profile data belong in cart storage or operation receipts.

## Merge and concurrency rules

- Merge matching book quantities by addition, capped at ten and current stock. Keep existing account lines. Skip new missing/archived/out-of-stock guest lines. Preserve existing unavailable account lines unchanged.
- Return additive `mergeNotices: [CartMergeNotice!]!` on `AccountCart` (empty for ordinary reads/writes). Each notice contains `{ bookId: ID!, reason: CartMergeNoticeReason! }`, with reasons `UNAVAILABLE`, `QUANTITY_LIMIT`, or `LINE_LIMIT`, so the UI can explain adjustments.
- Account lines take priority at the twenty-line limit. Process guest lines in numeric book-ID order, accepting new available lines until the limit and recording skipped lines. This rule is deterministic and never discards an account line.
- Use a transaction to check `expectedRevision`, change lines, increment revision, and persist the successful operation receipt. PostgreSQL row locking and SQLite transactions must produce equivalent outcomes, including concurrent first-cart creation.
- A stale revision returns `CART_CONFLICT` with no write. The caller reloads and asks the shopper to retry the edit; never silently overwrite or automatically rebase an absolute quantity.
- Persist successful request keys per owner with a normalized payload fingerprint. Check receipts before the revision check. The same key/payload retries without a second change and returns the current cart; a reused key with different input returns `BAD_USER_INPUT`.
- Replay merge notices from the successful receipt even if the current cart changed afterward. Validation/conflict failures do not consume the key. Keep receipts for the account lifetime in this first version; any future pruning requires an explicit replay policy.
- Guest merges have a frozen snapshot, key, and intended owner on the frontend. An uncertain merge for A is never retried as B's merge. Account switching must not transform account items into guest items.

## Checkout and payment cleanup

- Add optional `cartRevision: String` to `CreateCheckoutInput`. Existing callers can omit it; their existing checkout behavior stays compatible and does not trigger server-cart cleanup.
- The updated frontend sends it only after cart saves/merge complete. For a new request, validate revision and exact equality of submitted IDs/quantities with the saved cart atomically with order creation and existing stock reservation. Mismatch returns `CART_CONFLICT` before a provider call or new reservation.
- Capture submitted cart line versions/quantities with the checkout request. Existing request-key replay rules remain authoritative: a resumed/replayed request uses its original snapshot rather than requiring today's cart to match. Include cart revision in new checkout request fingerprints.
- Clear purchased lines only when provider reconciliation first confirms paid truth. In the same local transaction, remove each submitted line only if its current version/quantity matches the snapshot, update cart revision if needed, and record cleanup completion for the order.
- Preserve later additions and every edited or removed/re-added line in full, including edits to a purchased book. This conservative rule avoids deleting new shopping intent; it does not promise to subtract purchased quantities from an edited line.
- Cleanup must work through worker/webhook reconciliation without the browser returning. Duplicate events, return-page polling, restart recovery, refunds, or cancellation never repeat cleanup or restore purchased lines to the cart.
- Pending, failed, expired, or uncertain payment leaves the cart untouched. No provider network call is held inside a cart/database transaction.

## Persistence and affected boundaries

The additive migrations create `account_carts` (unique owner, revision),
`account_cart_items` (owner/book, quantity, line version), `cart_operations`
(owner/request key, fingerprint, notices), and `checkout_cart_snapshots` (order,
owner, submitted lines, cleanup marker). SQLite migration `0009_groovy_secret_warriors`
and PostgreSQL migration `0002_majestic_warbird` preserve existing application data;
they do not infer ownership for old browser carts or historical orders.

- Use unique constraints for owner and owner/book, foreign keys to users/books/orders, bounded values, and account deletion cleanup. Book references must preserve existing order snapshots and archive behavior.
- Generate additive migrations for both providers; existing accounts start empty. No legacy order or shared local cart is assigned to an account by guessing ownership.
- Extend [SQLite schema](../../src/database/schema.ts), [PostgreSQL schema](../../src/database/postgresql/schema.ts), [DomainStore](../../src/database/store.types.ts), provider stores, and readiness checks.
- `src/modules/cart/` uses the existing repository/service/resolver/validation
  boundaries and is composed in [schema.ts](../../src/graphql/schema.ts), resolver
  wiring, and application setup.
- [Order schema](../../src/modules/orders/order.schema.ts), payment validation,
  repository/reconciliation, checkout request fingerprints, and generated resolver
  types are coordinated from their source definitions; generated types are not edited
  by hand.

## Acceptance criteria

- [x] Customer A's cart survives logout/restart and loads on another device; B cannot read, modify, or receive A's cart through any API.
- [x] Customer, Staff, and Admin have the same own-cart shopping behavior; guests cannot use account-cart APIs.
- [x] Guest merge respects deterministic quantity/line limits, reports adjustments, and applies once after lost responses/repeated login.
- [x] Concurrent edits cannot overwrite an accepted edit silently; duplicate mutation retries cannot apply twice.
- [x] Unavailable saved lines remain repairable; cart save never reserves inventory or fixes a price.
- [x] Cart-linked checkout rejects stale snapshots before reservation; compatibility checkout remains supported.
- [x] Confirmed payment removes only unchanged submitted lines once, without depending on browser return; later changes and other accounts' carts survive.
- [x] SQLite/PostgreSQL parity, additive populated-database migration, rollback compatibility, and restart recovery are verified.

## Validation and rollout

Focused integration coverage exercises ownership, merge/idempotency, revision
conflicts, stock changes, payment cleanup, concurrent writers, line remove/re-add,
same-quantity edits, provider failure, duplicate paid events, and worker-restart
cleanup. Provider parity and populated-migration coverage use isolated databases.

Completed evidence: backend `bun run test` passed **232** tests with one
PostgreSQL-only test skipped in the SQLite run; lint, build, and codegen passed. The PostgreSQL
**36**-contract/parity and populated-migration checks passed. The coordinated frontend
suite passed **194** tests in **39** files, lint, build, and codegen; the existing chunk
warning remains. Full SQLite Chromium E2E passed **58** journeys in **5.1 minutes**;
the full PostgreSQL Chromium suite passed **58/58** journeys in **5.4 minutes** with
no filters or last-failed selection. Composed SQLite/PostgreSQL build smokes, populated
additive migrations, and cleanup passed; the wrapper exited cleanly with no remaining
test ports or PostgreSQL processes.
Manual desktop/mobile checks passed guest reload, one-time Customer merge, keyboard
quantity saves, pending-save reload warning, sign-out isolation, Staff/Admin persistence,
and blocked/retried mobile checkout behavior. Evidence and screenshots are retained in
the parent verification ledger. No production database, live Stripe, or live SMTP flow
was used.

Deploy the additive backend/migrations before the matching frontend. Root,
authentication, checkout/delivery, README, and cart documentation are reconciled.
Rollback preserves saved cart tables: disable the new frontend/API use together and
retain data. Rolling back to the old frontend restores its shared-browser behavior and
cannot provide account isolation; do not export server carts into the shared local key.

## Risks and release constraints

- **Legacy ownership:** the existing browser cart may have been edited by several accounts. The frontend requires confirmation before importing that unowned legacy cart; it is not automatically claimed by the first account at rollout.
- **Unsaved changes:** offline authenticated editing is deferred. Reject/roll back optimistic failures visibly, keep same-key retries scoped to the original account, and block checkout while saves are unresolved.
- **Storage growth:** durable receipts and saved carts add database rows. Measure growth before introducing a retention job; do not drop replay protection silently.
- **Rollback:** retain the additive cart tables and disable the matching client/API use
  together. An older client restores shared-browser cart semantics and cannot provide
  account isolation; never copy server carts into the shared browser key. A database
  rollback that removes these tables would discard saved carts and receipts, so it
  requires an explicit data-preservation decision.
