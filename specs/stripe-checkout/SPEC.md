# The Quiet Shelf API — Stripe checkout

> **Status:** Implemented. **Date:** 2026-10-07. Stripe hosted Checkout is available for local test payments only.

## Goal and agreed scope

Add Stripe hosted Checkout for local test payments before Staff processes an order.
Delivery is a later feature: collect no shipping address and charge no shipping fee.
Coordinate with [the storefront spec](../../../frontend/specs/stripe-checkout/SPEC.md).

The delivered journey is **Checkout → Payment pending → Paid → Staff accepts → Completed**.
Order status remains SUBMITTED → ACCEPTED → COMPLETED, or CANCELLED. Payment is
independent; Completed continues to mean handling finished, without asserting delivery.

Include signed-in checkout, authoritative pricing, payment confirmation, resumable
payment, expiry and inventory release, customer/workspace payment visibility, and
full refunds when Staff/Admin cancels a paid Submitted or Accepted order.
Exclude delivery/pickup, live payments, guest checkout, customer cancellation,
partial refunds, discounts, subscriptions, saved cards, automatic tax, delayed
payment methods, receipt emails, disputes, and multi-currency checkout.

USD, matching current cents-based prices, and card payments only are fixed for this
local test-only phase. The payment window is 30 minutes; the initial local deadline
has a one-minute guard so a provider Session can be created with a stable deadline.
The recovery worker runs at startup and every 60 seconds. This is not a production
launch.

## Existing behavior and compatibility

Historically, the [implemented workflow](../order-workflow/SPEC.md) created an unpaid
Submitted request through `placeOrder`, deducted stock once, and restored it on
cancellation. The new payment flow preserves those transactional rules, snapshots,
permissions, and history.

- New orders must use the payment flow. Keep the old `placeOrder` field temporarily
  for schema compatibility, deprecate it, and reject calls with BAD_USER_INPUT and
  a clear instruction to use `createCheckout`. It must not create an unpaid bypass.
  Deploy paired clients together; old clients cannot place new requests after release.
- Migrate existing workflow orders as `paymentRequired=false` and
  `paymentStatus=LEGACY_UNPAID`; never label them paid or invent provider records.
  They retain the existing accept/complete/cancel rules and have no Pay button.
  All newly created orders explicitly set `paymentRequired=true`.
- Preserve all existing data. No automatic reset, seed, or deletion. Earlier local
  reset permission is not needed for this additive migration. The existing guard
  for populated pre-workflow databases still applies.
- Root/auth/workflow specifications are synchronized descriptions of current behavior.

## GraphQL contract

Extend existing order schema sources; generate resolver/client types through codegen.

```graphql
enum PaymentStatus {
  LEGACY_UNPAID
  PENDING
  PAID
  EXPIRED
  REFUND_PENDING
  REFUNDED
  REFUND_FAILED
}
type OrderPayment {
  required: Boolean!
  status: PaymentStatus!
  currency: String!
  expiresAt: String
  paidAt: String
  refundedAt: String
}
input CreateCheckoutInput {
  items: [OrderItemInput!]!
  requestKey: String!
}
type CheckoutResult {
  order: MyOrder!
  checkoutUrl: String
}
extend type Mutation {
  createCheckout(input: CreateCheckoutInput!): CheckoutResult!
  resumeCheckout(orderId: ID!): CheckoutResult!
  refreshOrderPayment(orderId: ID!): MyOrder!
  retryOrderRefund(orderId: ID!): AdminOrder!
}
```

- Add `payment: OrderPayment!` to receipt, history, customer detail, and workspace
  order types. `totalCents` remains the saved book total; no extra fees or tax.
- Retain input bounds: 1–20 distinct books, quantity 1–10, existing numeric ID
  validation. `requestKey` is a UUID generated once for a deliberate checkout attempt.
  Identity and contact snapshots come from the server session, never client input.
- Customer mutations require a session and owner scope. Non-owned/missing mutation
  targets share BAD_USER_INPUT; missing/non-owned `myOrder` still returns null.
  Staff mutations require PROCESS_ORDERS before input validation/lookup.
- Preserve UNAUTHENTICATED, FORBIDDEN, BAD_USER_INPUT and CONFLICT. Add
  `PAYMENT_UNAVAILABLE` for disabled/configuration/provider availability failures;
  do not expose provider responses, credentials, or sensitive details.
- `checkoutUrl` is nullable: already-paid/terminal orders have no URL; a recovered
  request can return its current order instead of creating another payment.
  Resume returns the same still-open session. Expired orders require a new deliberate
  checkout and stock check; never extend the old reservation by creating another session.
- `refreshOrderPayment` retrieves provider truth and reconciles through the same
  idempotent service used by webhooks. It cannot accept client payment status/amount.
- `retryOrderRefund` only retries REFUND_FAILED for a Cancelled paid order. Repeated
  calls during REFUND_PENDING/REFUNDED return current details without a second refund.

## Checkout, pricing, and durable retries

1. Validate session/input and check the `(user_id, request_key)` mapping. Reusing
   a key with different normalized lines returns CONFLICT; matching retries reuse
   the original order and provider operation, even after a lost response.
2. In one provider-scoped transaction, validate current catalog/stock, save immutable contact,
   line-price and USD total snapshots, create Submitted/history, reserve inventory
   using the existing stock deduction, and persist a pending checkout operation.
   Reject totals below Stripe's USD minimum (50 cents) or beyond existing supported
   integer bounds before reserving. Free orders are outside this phase.
3. Outside the DB transaction, create Stripe Checkout in payment mode from saved
   prices/quantities. The initial local deadline is 31 minutes from reservation so
   the provider receives a stable expiry at least 30 minutes away. Disable adjustable
   quantities, shipping, discounts, automatic
   tax, and currency conversion. Use an operation-specific Stripe idempotency key.
   Put local order reference in Session and PaymentIntent metadata.
4. Persist Session/PaymentIntent references and the provider expiry timestamp,
   then return the hosted URL. Build success/cancel URLs solely from configured
   FRONTEND_ORIGIN and the local order ID. Neither redirect changes payment state.

Never hold a database transaction across a Stripe network call. Use persisted
operation state and short leases to coordinate requests and the recovery worker.
After a definitive creation rejection with no provider session, cancel and restock
atomically. A timeout is uncertain: keep the reservation, recover using the original
idempotency key, and never blindly create another session or release stock.

Recovery runs on startup and every 60 seconds, with bounded batches, timeouts and
backoff. Finish/recover session creation within Stripe's idempotency retention window;
if unresolved beyond 24 hours, flag manual reconciliation and do not recreate the
payment. Persist operation errors/retry time without raw secrets or payment payloads.
No external queue or scheduler is required for this local phase.

## Payment confirmation and expiry

- Add `POST /api/payments/stripe/webhook` with route-local raw JSON bytes (100 KiB
  limit), registered before any JSON parser that could consume them. Preserve
  Better Auth handler ordering and GraphQL origin checks. Stripe requests need no
  browser cookie/origin; verify the Stripe signature using the webhook secret.
- Invalid payload/signature returns 400; oversized payload 413. Valid irrelevant
  events return 200. Return 2xx only after the event is processed or durably queued;
  transient persistence failures return 5xx so Stripe can retry.
- Handle `checkout.session.completed`, `checkout.session.expired`,
  `refund.created`, `refund.updated`, and `refund.failed`. Reconciliation retrieves
  current provider resources; event arrival order must not regress paid/refunded state.
- Before marking Paid, verify test mode, stored Session/PaymentIntent association,
  local metadata, successful payment, exact saved amount, and USD currency.
  A browser success query parameter or unpaid completed Session is not proof.
- Persist unique processed event IDs with successful state changes in one transaction.
  Unrelated resources are ignored; associated mismatches are recorded for inspection
  and block fulfillment. Duplicate/concurrent events must not duplicate effects.
- Paid leaves the order Submitted and stock already reserved. Accept and Complete
  require PAID for payment-required orders. Staff sees pending/expired/refund state
  separately from the order status.
- When the deadline passes, fetch/expire the Stripe Session and confirm it cannot
  accept payment before cancelling/restocking. Time alone is not proof of nonpayment.
  If paid, reconcile Paid instead. If Stripe is unavailable, keep the reservation
  and retry; the UI says confirmation is delayed. For confirmed expiry, atomically
  set EXPIRED and CANCELLED, restore stock once, and append the customer-visible
  reason `Payment window expired` and a system-attributed workflow event.
- Do not reopen an expired/cancelled order. An unexpected verified payment for an
  already-cancelled order queues a full refund, keeps the order Cancelled, and never
  deducts stock or makes it fulfillable again.
- Stopping the API delays automatic expiry; startup reconciliation catches up.
  A payment return refresh offers recovery even when local webhooks were delayed.

## Staff cancellation and full refunds

Preserve expectedStatus, terminal/no-op rules, and trimmed 1–500-character reasons.
For a new Pending order, persist cancellation intent and expire its Checkout
Session first. While this is unresolved, disallow accept, complete, and resume;
return PAYMENT_UNAVAILABLE on an uncertain provider outcome and reconcile on retry.
If payment wins the race, follow paid cancellation instead of releasing a live session.

For a Paid Submitted/Accepted order, atomically set Cancelled, restore stock once,
save the reason/history/Activity, set REFUND_PENDING and queue a full refund. The
durable worker requests that refund outside the transaction with a stable
idempotency key. Cancellation success means the order is cancelled, not refunded.
Confirmed refund success sets REFUNDED/refundedAt; pending remains REFUND_PENDING;
failure sets REFUND_FAILED with a safe message and Staff/Admin retry action.
Repeated cancellation must never duplicate inventory restoration or refund requests.
Do not allow cancellation of Completed orders or manual Mark paid/Mark refunded.

## Persistence, attribution, and boundaries

- Extend `src/database/schema.ts` with order payment-required/status/currency and
  timestamps, request-key mapping, unique provider references, durable provider
  operations, and deduplicated provider events. Generate/review SQL and metadata.
  Index pending work and owner/request-key lookups; constrain enums and amounts.
- Keep provider objects/keys/internal errors out of customer GraphQL data and general
  Activity. Record safe payment-status changes as ORDER_PAYMENT_CHANGED with
  ORDER_PAYMENT_STATUS; retain Admin-only Activity access.
- System expiry/payment/refund events need explicit system attribution rather than
  impersonating Staff. Extend workspace event output with `actorType: USER | SYSTEM`,
  and nullable actorRole for system events; existing user snapshots stay unchanged.
  Customer workflow history retains its safe status/time/reason shape.
- Payment transitions, order/history/Activity writes and inventory restoration use
  the same guarded transaction when they represent one local business change.
- Add a focused `src/modules/payments/` service/provider/repository boundary, reuse
  existing order validation/transaction helpers, and inject a fake provider in tests.
  Update `src/app.ts`, `src/server.ts`, `src/config/env.ts`, order modules, Activity,
  schema composition, generated types, migrations and operational docs as needed.

## Configuration and local operation

`STRIPE_CHECKOUT_ENABLED=false` by default, `STRIPE_SECRET_KEY` and
`STRIPE_WEBHOOK_SECRET` in backend environment configuration and `.env.example`.
Enabled mode requires valid test credentials and rejects live keys and live-mode
provider resources. Disabled mode keeps existing reads/workflow available but
does not silently restore unpaid placement. Local API tests use injected providers.
Credentials remain in ignored local environment files; rotate the exposed keys.
Hosted URL redirects need no frontend secret or Stripe.js publishable key.

Install the Stripe CLI, run `stripe login`, and use
`stripe listen --forward-to localhost:4000/api/payments/stripe/webhook`.
Use that listener's signing secret and restart the API after configuration changes.
Where the CLI is installed locally for this project, invoke that local executable
instead of requiring a global installation. Keep the CLI and its data directory
ignored. Use the official Stripe installation instructions for the platform.
Use the real hosted test checkout for end-to-end verification; generic CLI trigger
events alone do not demonstrate local order association.

## Acceptance criteria and validation

- [x] Saved totals/stock are authoritative; invalid, insufficient-stock or subminimum
      orders create no reservation. Declines cannot show Paid or enable Staff acceptance.
- [x] Lost responses, duplicate tabs, concurrent requests and recovery after restart
      reuse one order/session/deduction for the same key; changed lines conflict.
- [x] Signed webhook or server reconciliation confirms exact provider amount/currency;
      forged signatures, URLs, ownership and mismatched resources cannot mark Paid.
- [x] Duplicate/out-of-order events and rollback failures do not duplicate local effects.
- [x] New orders require payment; old orders remain explicitly unpaid and processable.
- [x] Expiry and cancellation races confirm provider state before releasing stock;
      archived-book and duplicate-line restoration retains existing correctness.
- [x] Paid cancellation queues one full refund; pending, successful, failed and retried
      refunds remain accurate across network failure and API restart.
- [x] Unexpected late payment on a Cancelled order refunds without reopening/restocking twice.
- [x] Owner/session and Staff/Admin permissions protect every operation; system attribution
      and safe Activity remain correct. No secrets/card details enter Git, application logs,
      or client data. Stripe CLI listener output is local operational output and can display
      its signing secret; keep it out of captured logs and documentation.
- [x] Additive migration preserves existing IDs, lines, totals/history and legacy semantics.

Focused provider/service/API, migration, atomic rollback, concurrency, restart,
permission, and fake-clock tests passed. Backend tests (136), codegen, lint, and build;
frontend tests (105), codegen, lint, build, and 33 isolated browser journeys passed.
Manual Stripe Sandbox verification covered a signed-webhook payment for a $16.99 USD
cart and a staff cancellation/full-refund confirmation, including one stock restoration.
Automated coverage verifies the business failure paths; manual decline, 3DS, and
provider-outage verification remain follow-up coverage. Automated suites do not access
development SQLite or require real Stripe credentials.

Rollback: disable new checkout and stop the worker before reverting code. Keep
payment records and reconcile/refund outstanding provider operations; never revert to
unpaid placement or drop payment tables while money operations remain unresolved.
The paired root, authentication, workflow, Activity, README, AGENTS, and environment
documentation is synchronized with this verified delivery.

## Review decisions and references

USD, 30-minute expiry, legacy-order exemption, and full refunds are implemented
scope. Live launch, tax treatment, and delivery require separate specifications.

- [Stripe hosted fulfillment and local webhooks](https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted)
- [Checkout Session creation and expiry](https://docs.stripe.com/api/checkout/sessions/create)
- [Webhook signatures and retries](https://docs.stripe.com/webhooks)
- [Refund lifecycle](https://docs.stripe.com/refunds)
