# Review remediation

**Status:** Partially implemented

**Date:** 2026-10-21

**Branch:** `docs/review-remediation-spec`

**Baseline:** `6c00995` on `main`

## Purpose and delivery status

Record the audit, clean-code and QA findings and follow-up suggestions, with evidence and testable acceptance criteria. R1–R3, S2, S3 and S5 are delivered. S1, S4 and S6 remain deferred or optional.

The [frontend companion](../../../frontend/specs/review-remediation/SPEC.md) owns cart readability, shared GraphQL error parsing, bundle delivery, safe admin return links and the client side of book-edit concurrency.

## Review inventory

### Remediation delivery — verified 2026-10-22

**Status:** Delivered for R1–R3; deferred inventory retained below.

The delivered work covers R1, R2 and R3, coordinated with frontend R4–R6 and S7. It preserves the existing S2, S3 and S5 implementations. Notification and operational-logging specifications describe the verified lifecycle behavior; checkout's public contract is unchanged.

The delivered slices introduced no schema, migration or public API changes. Final-admin protection (S1), live-payment support (S4), optional dependency assembly cleanup (S6), and mandatory book-revision enforcement remain separately deferred. Production infrastructure release gates remain applicable.

- **R1, P2:** Delivered silent successful notification-stream disconnects, precise route classification, and one safe termination diagnostic for write failure or backpressure.
- **R2, P3:** Delivered independent publisher/subscriber outage episodes and recovery diagnostics.
- **R3, P2:** Delivered a module-local shared checkout-pricing validator with unchanged public behavior.
- **R4, P2:** Delivered in the frontend companion: focused guest synchronization and captured account-operation helpers preserve the cart contract.
- **R5, P3:** Delivered in the frontend companion: shared GraphQL error-code reading preserves each feature's selection policy.
- **R6:** Delivered in the frontend companion: ten admin page modules are lazy entries; large remaining chunks and the absence of field-performance measurements are recorded there.
- **S1:** Final-admin demotion is allowed. Explicit existing policy; proposed policy change awaiting approval.
- **S2, P2:** Delivered staged optimistic concurrency for book-detail forms; stock remains atomic deltas.
- **S3, P2:** Delivered evidence-based cover normalization failure classification.
- **S4:** Order emails hardcode test-payment wording. Correct under the current test-only provider contract; live-payment support deferred.
- **S5:** Shared authentication limits are delivered; see [the dedicated rate-limit specification](../auth-rate-limiting/SPEC.md).
- **S6:** Notification publish callback captures a later declaration. Safe in current initialization order; optional readability work, not a confirmed initialization failure.
- **S7:** Delivered in the frontend companion; list return links now require known relative paths and normalize legacy customers paths.

## R1: Notification stream logging

**Affected:** [app.ts](../../src/app.ts), [notification.sse.ts](../../src/modules/notifications/notification.sse.ts), [operational logging spec](../operational-logging-readiness/SPEC.md).

Before delivery, the generic logger omitted `/api/notifications/stream` from route classification and treated a response close before `writableFinished` as warn-level `http.aborted`. Browser navigation, tab close and EventSource reconnection normally close an open stream this way.

Delivered behavior:

- Canonicalize the existing case-insensitive stream path, including its optional trailing slash, to the stream route; retain server-owned request IDs and safe allowlisted context.
- Suppress ordinary successful-stream client disconnect completion logs. Preserve generic request logging for unsuccessful stream setup, including 401, 403, 429 and 503 responses.
- Emit one `notifications.stream_terminated` warning for server-side write failure or sustained backpressure, with a server-owned request ID and allowlisted `streamFailure` of `WRITE_FAILED` or `BACKPRESSURE`; no raw errors, cookies, payloads or recipient identities are logged.
- Preserve stream authorization, connection limits, timers and cleanup. Synchronous write/header/end failures and asynchronous response errors release counters and timers immediately; the error consumer remains until the real close, and late authorization work is ignored. No persistence or API response contract changes.

Acceptance criteria:

- [x] Open and normally disconnect a successful stream: no warning-level `http.aborted` and no `unmatched` route entry.
- [x] Stream setup errors retain their existing HTTP status and correctly classified log severity.
- [x] Injected write/backpressure failure releases connection accounting and produces one safe diagnostic.

## R2: Independent Redis connection health

**Affected:** [notification.live.ts](../../src/modules/notifications/notification.live.ts), [notification spec](../in-app-notifications/SPEC.md).

Before delivery, one `degraded` flag represented both connections and only subscriber readiness cleared it. A publisher-only outage followed by recovery could suppress warnings for later publisher outages.

Publisher and subscriber outage/recovery state is independent. Each connection warns once per outage episode and reports its own readiness. Successful publish resets publisher suppression; subscriber readiness requires successful subscription. Generation and shutdown guards prevent stale recovery work from changing state. Bounded reconnects, best-effort hints, durable inbox rows and reconnect reconciliation remain unchanged. Safe lifecycle diagnostics carry a publisher/subscriber discriminator.

Acceptance criteria:

- [x] Publisher fails, recovers and fails again while subscriber stays healthy: both outage episodes are logged, without repeated warnings inside an episode.
- [x] Subscriber reconnect still resubscribes and invalidates missed hints; `ready` remains false until subscription succeeds.
- [x] Failure/recovery interleavings and close during reconnect neither hide the other connection's state nor leak resources.

## R3: Shared checkout pricing validation

**Affected:** [payment.repository.ts](../../src/modules/payments/payment.repository.ts), [checkout spec](../stripe-checkout/SPEC.md).

Quote and reserve now use a small module-local `checkoutPricing` calculation/validation unit with the relevant `DomainStore`; quote uses the ordinary store and reserve uses its transaction store. Sorted locking, idempotency, cart revision checks, saved order snapshots and writes remain in their existing transaction boundaries.

Preserve the current accepted input set, stored-price authority, USD calculations, delivery fee, minimum subtotal of 50 cents, total maximum of 2,147,483,647 cents and safe-integer checks. Preserve existing public error codes and path-specific error wording unless separately proposed; shared validation may return a structured failure mapped by each caller. Reservation must always revalidate current data, never trust a prior quote. No GraphQL/schema/migration change is required for this refactor.

Acceptance criteria:

- [x] Quote and reserve agree on eligibility and calculated amounts for unchanged catalog/configuration, including monetary boundaries.
- [x] Changed price, stock, delivery configuration or cart revision is still rejected/requoted as currently specified.
- [x] Transaction rollback, request-key reuse, refunds and stock concurrency remain covered by existing integration tests on both providers.

## S1: Final-admin protection decision

**Current contract:** [staff spec](../staff/SPEC.md) explicitly permits self/final-admin demotion, and [admin-access CLI](../../src/modules/admin/admin-access-cli.ts) supports operator recovery. This is not a defect against that contract.

**Recommended optional policy:** Refuse a GraphQL role change that would leave zero admins. Self-demotion remains allowed when another admin remains. Apply the guard through canonical and legacy mutation aliases, preserve no-op role updates, and record no activity on rejection. Operator grant/revoke remains the explicit recovery override, with its existing operator activity attribution.

The count and role change must share a concurrency-safe invariant on SQLite and PostgreSQL. Locking just the target user or reading an unprotected count is insufficient: concurrent demotions of different users must not both succeed. Specify the common serialization mechanism before implementation. Do not weaken fresh authorization checks.

If approved, update staff/admin specifications before code. Use existing `BAD_USER_INPUT` for the refused transition with a safe message explaining another administrator is required; no new mutation is necessary.

Conditional acceptance criteria:

- [ ] Sole-admin demotion through every GraphQL alias fails without writes or activity.
- [ ] Two concurrent demotions cannot leave zero admins; promotion, no-op updates and permitted self-demotion still work.
- [ ] Operator recovery remains possible and explicitly documented/tested.

## S2: Optimistic concurrency for book details — delivered

**Affected:** [book schema](../../src/modules/books/book.schema.ts), [admin book repository](../../src/modules/books/admin-book.repository.ts), [book validation](../../src/modules/books/book.validation.ts), both database schemas/stores and generated resolver types.

Before this delivery, `updateBook` wrote all detail fields with no expected revision, allowing one stale form to overwrite another save. The delivered revision guard protects updated clients. Detail input does not include stock; `adjustBookStock` retains atomic deltas.

Delivered contract: the additive optional-argument compatibility stage is live, and the updated frontend sends its loaded revision. Mandatory enforcement remains deferred until legacy clients retire. Conflict recovery requires explicit confirmation before discarding unsaved details or a staged cover; a failed reload preserves both.

- `AdminBook.detailsRevision: Int!` and persisted `details_revision` defaulting to zero are separate from `coverRevision`; the stored value is constrained from 0 through 2,147,483,647.
- `updateBook(id: ID!, input: AdminBookDetailsInput!, expectedRevision: Int)` accepts the optional argument. A supplied revision must be an integer from 0 through 2,147,483,647; stale revisions return `CONFLICT` without detail changes or Activity.
- In one transaction, compare the expected revision, update details, increment the revision and insert actual-change activity. Every successful matching update consumes a revision, including an unchanged-value save; retain no activity entry when no fields changed.
- Cover edits, archive changes and stock deltas do not change this detail revision. Detail writes must never restore a stale stock or cover value.
- During compatibility rollout, omitted revisions retain legacy writes but must also increment `detailsRevision`, so revision-aware clients detect intervening legacy edits. Deploy backend support, then revision-aware frontend operations; only after old clients are retired make `expectedRevision: Int!` mandatory. The final requirement is a breaking schema change and must not precede the frontend rollout.
- Generated additive SQLite and PostgreSQL migrations set existing rows to zero; backend/frontend types were regenerated from source definitions. The SQLite wrapper also adopts only the exact known pre-release local draft journal state without reset or history rewrite; its database-support specification records the strict compatibility guard.

Acceptance criteria:

- [x] Two updates with the same expected revision yield exactly one success and one conflict on both providers.
- [x] Stale saves change no fields/revision/activity; valid saves increment atomically and preserve authorization/validation limits.
- [x] Migration preserves existing books, stock and covers; legacy and revision-aware clients interoperate during the staged window.
- [x] Cover updates and stock adjustments retain their existing independent concurrency semantics.

## S3: Cover failure classification — delivered

**Affected:** [cover.image.ts](../../src/modules/covers/cover.image.ts), [cover contract](../book-cover-uploads/SPEC.md).

Keep 413 for oversized bytes, 415 for unsupported MIME, and 422 `INVALID_COVER_IMAGE` for corrupt, mismatched, animated or dimension/pixel-invalid content. Keep the existing two-decode admission limit returning 503 `COVER_UNAVAILABLE`.

The delivered classification is grounded in the pinned decoder's actual errors. Explicit application validation failures and verified malformed-input failures map to 422; the bounded PNG chunk parser rejects a structurally truncated PNG before Sharp. A bare or unfamiliar Sharp wrapper, including `corrupt header`, is not enough to blame input and returns safe 503, as do recoverable allocation/resource/backend failures. No raw decoder text or internal paths reach clients/logs.

Acceptance criteria:

- [x] Existing corrupt/unsupported/animated/pixel-limit fixtures retain their expected status and safe code.
- [x] Injected recoverable resource and unexpected internal failures return safe 503 and release the decode slot in `finally`.
- [x] Failed normalization never replaces the existing cover or changes its revision/activity.

## S4-S6: Preserved and conditional behavior

### S4: Payment mode provenance

The [environment validator](../../src/config/env.ts) accepts test keys only; the [Stripe provider](../../src/modules/payments/stripe.provider.ts) rejects live sessions, events and refunds. Keep `testPayment: true` in [order emails](../../src/modules/email/email-outbox.writer.ts) while this contract holds. Do not enable live keys or remove test wording as part of remediation.

Before future live-payment support, specify provider-verified mode persisted with the order, historical backfill restricted to established test-only rows, immutable outbox snapshots and consistent receipt/UI/notification wording. That is a separate payment feature, not an approved migration here.

### S5: Shared auth budgets — delivered

Historical context: at review time, auth budgets were process-local and reset on restart. The delivered [auth-rate-limiting specification](../auth-rate-limiting/SPEC.md) supersedes that limitation: API instances use a dedicated Redis connection, atomic fixed windows, a deployment-specific namespace, HMAC-obscured keys, and the existing trusted-IP policy. Redis failure returns the documented neutral `AUTH_RATE_LIMIT_UNAVAILABLE` 503; it never falls back to memory in Redis mode. This connection is independent of email queues and notification live-delivery flags, participates in API readiness, and closes during startup failure and shutdown.

Focused two-process, restart, expiry, Redis loss/recovery, timeout, readiness-recovery logging, privacy, cleanup, and PostgreSQL parity evidence is recorded in that specification. S1, S4, and S6 remain proposed/deferred.

### S6: Dependency assembly readability

The callback in [app.ts](../../src/app.ts) captures `notificationLive` before declaration but is not invoked by store construction. Current calls occur after initialization. No runtime fix is required. If reordered for clarity, preserve lazy publication, disabled-feature behavior and cleanup for failures in cover storage, email initialization, auth or Apollo startup. Creating Redis clients earlier without extending cleanup would introduce a resource-leak risk.

## Verification, rollout and documentation

Final verification: backend passed 375 with 4 skips across 64 passing files (379 total); the focused notification lifecycle suite passed 27/27; lint and build passed. PostgreSQL contract tests passed 49/49, and compiled SQLite/PostgreSQL smokes plus populated-migration checks passed. Frontend tests passed 373/373 across 74 files; lint/build passed; the full Chromium suite passed 94 with 1 configured native-notification zoom skip, and the focused localized admin loader suite passed 3/3. The three earlier review regressions covered the bare Sharp wrapper (503), reset native cover input (empty file list), and persisted negative revision (rejected).

- R1–R3 are delivered independently of the additive detail-revision rollout. S1 requires its explicit decision; S4 remains deferred and S6 optional.
- Add failing behavior tests for confirmed gaps before fixes; use passing existing tests for behavior-preserving extraction. Prefer real isolated SQLite/PostgreSQL tests for transactions and concurrency.
- Run `bun run test`, `bun run lint`, `bun run build`; run `bun run test:postgres` for database changes and coordinated isolated frontend browser journeys for contract/customer-flow changes. Use isolated Redis for two-process outage/recovery tests, never production services.
- Live production Redis TLS/ACL/proxy/capacity and retention scheduler gates remain unverified; boundary-event tests do not substitute for real Redis or infrastructure smoke testing.
- Synchronize affected feature specs and root `SPEC.md`/README after delivery; retain evidence for each delivered slice. Deferred decisions must not be checked off as implemented.
- Logging/refactor/error fixes can be reverted independently. Detail-revision migrations are additive: keep columns on application rollback; do not remove data. Retain compatibility until both clients and server agree before enforcing mandatory revisions.

## Decisions required before affected implementation

- **S1:** Approve changing final-admin policy and retaining the operator override; choose the database serialization mechanism.
- **S5:** Production rollout still requires the Redis persistence, no-eviction, TLS, ACL, secret, and prefix-rotation safeguards in the dedicated specification.
- **S2 rollout:** Establish when legacy clients are retired before requiring the new GraphQL argument.
- **R1/R2:** No implementation ambiguity remains. Production Redis TLS/ACL/proxy/capacity and retention operations remain release gates for the notifications feature.
