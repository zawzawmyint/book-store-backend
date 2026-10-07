# Stripe checkout implementation plan

> Execute the user's approved payment specification on `feat/stripe-checkout` in both repositories. Use test-driven development and a final independent review.

**Goal:** Hosted Stripe test checkout with durable payment/expiry/refund reconciliation and payment-aware order handling, without delivery.

**Architecture:** Keep saved order pricing and SQLite inventory transactions authoritative. A provider adapter and durable operations reconcile external Stripe calls outside transactions. React uses generated GraphQL operations and a hosted redirect.

**Spec:** [Backend](../../../specs/stripe-checkout/SPEC.md) and [frontend](../../../../frontend/specs/stripe-checkout/SPEC.md).

## Constraints

- Test mode only, USD, card payments, 31-minute initial session deadline (60-second guard above the Stripe 30-minute minimum), 60-second recovery.
- Preserve existing data as Legacy unpaid, prevent new unpaid order placement.
- Never expose credentials or hold SQLite transactions across external calls.
- No shipping, fees, tax, partial refund or live launch.
- Backend and frontend ownership are separate repositories; generated contract is the integration boundary.

## Review focus

- Unknown provider outcome must retain inventory until reconciliation proves it is safe.
- Duplicate or concurrent requests must reuse one order and payment operation.
- Cancellation/payment races must refund unexpected late payments without reopening.
- Return URL and changed cart must not fabricate success or remove unrelated cart edits.
- API restarts and legacy orders must retain state and truthful attribution.

## Task 1: Backend payment lifecycle

**Ownership:** backend source, tests, generated types, dependencies and migrations.
**Interface:** the exact GraphQL contract in the backend spec; injectable provider through createApp, shared payment reconciliation service/worker.

- [x] Add and run failing tests for checkout authorization, authoritative totals, request-key retries, payment checks, expiration/restock, refunds, legacy compatibility, webhook signatures and restart recovery.
- [x] Implement payment provider/service/repository, schema/migration, route-local raw webhook, workflow gates and Activity/system attribution.
- [x] Run affected tests, codegen, full backend tests, lint and build; expected all pass.

## Task 2: Frontend checkout and order integration

**Ownership:** frontend source, operations/generated types, component and isolated browser tests.
**Interface:** Task 1's GraphQL contract, injectable fake provider for e2e only.

- [x] Add and run failing tests for payment redirect, return confirmation, cart retention and changed-cart protection, pending resume, Staff gating and refund feedback.
- [x] Implement hosted redirect and return page, attempt storage, account/workspace payment UI, Activity/system rendering; generate client types from backend schema.
- [x] Update isolated browser fixtures to the payment lifecycle; run frontend full tests, lint, build and browser checks; expected all pass.

## Task 3: Local integration and final review

**Ownership:** root integration; spec-updater owns documentation after code settles.

- [x] Read the user-authorized key file without displaying its contents; put test credentials only in ignored backend configuration, check Stripe CLI availability.
- [x] Review full changes independently and resolve material findings with regression tests.
- [x] Apply additive migration locally, restart API, and verify checkout contract/provider connectivity without charging real money or deleting data.
- [x] Delegate final documentation reconciliation, review its diff, mark only verified criteria complete and report any real Stripe manual test limitation.

## Progress

- Branches created; specification approved by the user's implementation request.
- Backend: 136 tests across 22 files, lint, build and codegen passed.
- Frontend: 105 tests, all 33 browser journeys, lint, build and codegen passed.
- Independent review findings resolved: terminal unpaid attempts retire safely; recovery batches advance fairly past unresolved work.
- Local additive migration preserved existing orders and stock. Real Stripe sandbox payment and full refund verified; no real money charged.
- Test credentials, CLI runtime, logs and database backup are ignored by Git. Documentation reconciled by spec-updater and its diff reviewed; no blockers. Changes remain local and uncommitted.
