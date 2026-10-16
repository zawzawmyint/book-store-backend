# 📨 Production Email Notifications Plan

> **Goal:** Deliver auth and order emails through a database outbox, separate BullMQ queues in Redis, and an independent email worker.

---

## 🎯 Objective

Replace process-local auth email sending with durable background work and add
customer order notifications. Preserve existing auth/payment/order contracts and
make retries, outages, expiry, and operational recovery reviewable.

**Status:** Proposed; documentation only. **Branch:** `feat/production-email-notifications`
in the backend repository. **Spec:** [Production email notifications](../../../specs/email-notifications/SPEC.md).

This plan covers implementation after review. It does not enable live payments
or authorize production cutover. Use the existing spec-first/TDD workflow; run
each slice's meaningful failing tests before implementation, refactor green, and
commit the tested slice. Node.js 24+, Bun 1.3.14, SQLite development/tests, and
PostgreSQL production remain required.

---

## 📦 Scope

**In scope**

- Database outbox, BullMQ, Redis, `auth-emails` and `order-emails`, one independent
  worker process initially hosting dispatcher and both consumers.
- Existing verification/reset emails; new confirmation, shipment, cancellation,
  and successful-refund emails; production operations and verification.

**Out of scope**

- Marketing, delivery-confirmation emails, live Stripe activation, public email
  management APIs/UI, provider bounce webhooks, historical backfill, and rewriting
  the existing payment recovery worker.

---

## ⚙️ Assumptions & Constraints

**Technical**

- Database is authoritative; Redis job completion alone is not email success.
- Order/outbox writes share one transaction; Better Auth callbacks await durable
  recording but do not share the framework's token/user transaction.
- Queue payloads contain notification IDs only. Encrypt recipient/template
  payloads; preserve 3,600-second auth expiry and 120-second minimum send window.
- One worker replica initially, auth/order concurrency 2 each. Delivery is
  at-least-once processing with explicit UNCERTAIN outcomes, not exactly-once SMTP.

**Product / Business**

- Existing account authorization, test-payment labeling, cancellation/refund
  distinctions, delivery copy, and customer order links remain accurate.
- Production email readiness does not make the entire store production-ready.

**Dependencies**

- Pin compatible BullMQ/client versions and a tested Redis image during setup.
- Reuse Nodemailer, Better Auth 1.7.7, Drizzle, and existing store adapters.
- Production cutover needs hosting, provider limits, sender/domain/DNS access,
  encryption secrets, HTTPS origins, and monitoring/alert destinations.

---

## 🧩 Proposed Approach

Order transaction or auth callback → database outbox → dispatcher → BullMQ/Redis
→ matching auth/order consumer → existing SMTP transport → durable submission result.

**Existing files affected**

- [auth.ts](../../../src/auth.ts), [app.ts](../../../src/app.ts), and
  [server.ts](../../../src/server.ts): inject durable auth enqueueing, remove SMTP
  ownership from queued API startup, preserve HTTP/readiness contracts.
- [email.service.ts](../../../src/modules/email/email.service.ts): retain transport
  and inline test adapter; move queued sending into the worker.
- [payment.repository.ts](../../../src/modules/payments/payment.repository.ts) and
  [admin-order.repository.ts](../../../src/modules/orders/admin-order.repository.ts):
  write notifications in existing transaction scopes, including recovery paths.
- [schema.ts](../../../src/database/schema.ts),
  [PostgreSQL schema](../../../src/database/postgresql/schema.ts),
  [store.types.ts](../../../src/database/store.types.ts),
  [SQLite store](../../../src/database/sqlite/store.ts), and
  [PostgreSQL store](../../../src/database/postgresql/store.ts): additive outbox
  schema, migrations, conditional leases, uniqueness, sequencing, and retention.
- [env.ts](../../../src/config/env.ts), [logger.ts](../../../src/shared/logger.ts),
  [.env.example](../../../.env.example), [package.json](../../../package.json),
  [PostgreSQL runner](../../../scripts/test-postgresql.ts), README/root/affected
  feature specs: process config, scripts, redacted telemetry, and documentation.

**Proposed new files** (names below are planned, not existing implementation)

- `src/modules/email/email-notification.types.ts`: kinds, payloads, ledger states.
- `email-notification.repository.ts`: provider-neutral persistence policy and claims.
- `email-outbox.writer.ts`: transaction-scoped auth/order notification insertion.
- `email-payload.crypto.ts`: authenticated encryption and key rotation.
- `email-queue.ts`: queue construction, IDs, connections, retry settings.
- `email-dispatcher.ts`: outbox publication and Redis-loss reconciliation.
- `email-consumer.ts`: lease, expiry, ordering, attempts, send result classification.
- `email.templates.ts`: extracted existing auth templates plus order templates.
- `email.worker.ts`: independent process entry point, dispatcher and two consumers.
- `email-operator-cli.ts`: redacted inspection and preview/apply replay.
- `scripts/test-email.ts`, `test/email-notifications.test.ts`,
  `test/email-queue.test.ts`, `test/email-operations.test.ts`,
  `test/email-payload.test.ts`, `test/email-templates.test.ts`, and
  `compose.email.yaml`: isolated Redis/SMTP infrastructure and meaningful coverage.

All module basenames above are under `src/modules/email/`. Keep boundaries focused;
do not introduce a generic event bus or rebuild unrelated modules.

**Contracts:** no public GraphQL/HTTP shape changes. New internal notification
records, validated config, worker/operator commands, and additive migrations only.
Auth callback failure behavior must be integration-tested rather than inferred.

---

## 🚀 Execution Plan

1. **Durable ledger and encrypted payloads** — _(role: backend)_ — safe persistence
   and migration slice.

   Define `NotificationKind`, `NotificationPayload`, `NotificationRow`, and
   `NotificationDraft` in `email-notification.types.ts` using the spec's exact
   fields/states. Add DomainStore methods `insertEmailNotification(draft)`,
   `emailNotification(id)`, `claimEmailDispatch(now, limit, leaseToken)`,
   `claimEmailSend(id, now, leaseToken)`, and conditional
   `updateEmailNotification(id, patch, expectedLeaseToken)`; specify concrete
   return types and null/no-claim outcomes in that shared type contract before
   callers. Add query methods for predecessor lookup, reconciliation, and cleanup.
   Writer interface: `writeOrderEmail(tx: DomainStore, input: OrderEmailInput):
   Promise<string | null>` and `enqueueAuthEmail(input: AuthEmailInput):
   Promise<string>`; inputs use the shared discriminated payload types.

   First add failing integration tests for populated migration preservation,
   transaction rollback, duplicate insert, concurrent claim, stale-token update,
   and order sequence allocation. Add focused crypto tests for round-trip,
   tampering/AAD rejection, wrong key, and retained-old-key rotation. Implement
   both schemas/adapters and encryption, generate/review both provider migrations,
   and extend `test/migration.test.ts` plus PostgreSQL parity. Verify focused
   tests and parity pass; commit without modifying runtime database files.

2. **Queue dispatcher and worker execution** — _(role: backend)_ — real Redis to
   captured-SMTP delivery, isolated from HTTP.

   Build `createEmailQueues(config)`, `dispatchEmailBatch(now)`,
   `reconcileEmailJobs(now)`, and `processEmailNotification(id)` in the proposed
   queue/dispatcher/consumer files. Export typed contracts from their owning
   modules; pass database/transport/clock dependencies explicitly for isolated
   integration tests. Implement the spec's 1-second/50-row dispatch, 30-second
   dispatch lease/reconciliation, 60-second send lease, queue names/prefix,
   UUID job IDs, 4/8 send budgets, and 5-second exponential send backoff.

   First add failing `test/email-queue.test.ts` cases using real Redis and local
   captured SMTP: queue isolation, send success, transient/permanent failure,
   enqueue-before-ack race, missing/completed/failed Redis job reconciliation,
   concurrent consumers, budget persistence after job removal, and predecessor
   ordering after terminal failure. Inject crashes before publication, after
   publication, before SMTP, and after SMTP acceptance; require UNCERTAIN rather
   than blind resend for ambiguous sends. Implement only after each intended
   failure is observed. Add pinned disposable infrastructure and `test:email`;
   verify it fails loudly without infrastructure and passes with it. Commit.

3. **Move authentication email production to the outbox** — _(role: backend)_ —
   verification and password reset through `auth-emails`.

   Inspect installed Better Auth callback invocation/error handling, including
   signup and reset paths, and characterize it in `test/auth-email.test.ts`.
   Replace queued-mode `mail.send` with awaited `enqueueAuthEmail`; extract and
   reuse `authEmail` in `email.templates.ts`. Keep a capture/inline adapter only
   for explicitly selected development/test mode. Read actual token expiry;
   never regenerate links in the worker. Preserve generic reset/resend responses.

   First write failing tests proving no API SMTP/Redis call, durable recording
   before callback completion, successful links after worker restart, 120-second
   cutoff, resend/new-token identity, already-verified/changed-email/deleted-user
   suppression, consumed reset skip, and redacted persistence failure. Prove
   unknown-account responses and existing timing protection remain intact.
   Exercise both providers and real Redis/captured SMTP; verify existing auth
   email/session tests remain green. Record the non-atomic auth issuance window
   accurately and commit.

4. **Record and render order event notifications** — _(role: backend)_ — four
   order message types produced by actual committed transitions.

   Call `writeOrderEmail` within payment/admin-order repository transactions,
   including provider reconciliation, staff actions, and cancellation's direct
   payment updates. Snapshot data at event time; allocate sequence under the
   order lock. Add text/HTML templates using trusted origins and saved values.

   First add failing integration tests for PAID/SHIPPED/CANCELLED/REFUNDED,
   repeated webhook/recovery/status calls, no unpaid expiry/legacy notifications,
   no premature refund success, rollback on outbox insert failure, and payment
   after cancellation (cancel/refund notice, no purchase confirmation). Verify
   immutable totals/address/tracking/reason, test-mode label, escaping, and no
   staff/private data in templates. Extend existing payment/delivery suites on
   both providers; verify focused tests and commit.

5. **Production lifecycle and operator recovery** — _(role: backend)_ — deployable
   worker, safe config, monitoring, retention, and audited replay.

   Add role-specific config, `email.worker.ts`, worker/inspect/replay commands,
   and logger allowlist additions. API queued mode needs no SMTP/Redis connection;
   worker validates those dependencies and never seeds/migrates. Implement
   30-second graceful shutdown, durable UNCERTAIN recovery, health/heartbeat
   listener on loopback port 4010 (`EMAIL_WORKER_HEALTH_PORT`) with internal
   `/health` and `/ready`, 10-second loop heartbeats, redacted status/age metrics, and the
   specified alert thresholds. Build operator preview/apply behavior and linked
   replay records. Add bounded cleanup with auth immediate/deadline payload purge,
   order 7-day payload retention, and 90-day metadata retention.

   First add failing `test/email-operations.test.ts` and config tests for wrong
   role config, production inline rejection, Redis outage without API downtime,
   missing keys, auth queue reserve, shutdown during SMTP, payload/log redaction,
   replay restrictions/duplicate-risk acknowledgement, expiry, and cleanup.
   Inspect outputs for secrets; verify built worker start/stop and commands against
   disposable infrastructure, then commit.

6. **Integrated acceptance and documentation reconciliation** — _(role: fullstack)_
   — verified release candidate and operating runbook.

   Run backend `bun run test`, `bun run test:email`, `bun run test:postgres`,
   `bun run lint`, and `bun run build`. From the sibling frontend run
   `bun run test:e2e`; from the backend run `bun run test:postgres:browser` for
   existing auth/order journeys using queued email fixtures with isolated
   Redis/SMTP; adapt fixtures
   only when needed, with a separate frontend branch if files must change.
   No codegen is required unless review uncovers a necessary public contract change.

   Perform staged Redis restart/data-loss, worker kill/restart, duplicate payment
   event, SMTP refusal/ambiguous timeout, and backlog recovery exercises. Review
   migration/rollback preservation. After code/tests settle, delegate final doc
   reconciliation to the `spec-updater` subagent with sole ownership of README,
   root SPEC, auth-email/delivery/stripe-checkout/database-support specs and this
   feature spec. Wait, review its diff and gaps, and record actual verification
   evidence. Do not mark Implemented with unmet criteria; staging inbox/DNS/alert
   evidence remains a separate explicit production cutover gate.

---

## ✅ Acceptance Criteria

**Functional**

- [ ] Verification/reset and all four order messages use their specified queues.
- [ ] Auth links, order totals/snapshots, permission boundaries, and customer
  flows remain correct; duplicate events do not create normal duplicate sends.
- [ ] Database/outbox atomicity, dispatcher reconciliation, retry budgets,
  expiry, sequencing, inspection, and controlled replay match the spec.

**Non-functional** (performance, security, accessibility, reliability)

- [ ] API waits only for durable database recording; SMTP and Redis stay off its
  queued-mode request path. Redis outage does not lose committed notifications.
- [ ] Encryption/redaction/retention, bounded concurrency, shutdown/recovery,
  health signals, and production Redis requirements are verified.
- [ ] Email text alternatives and readable HTML work; ambiguous sends are visible
  and no unsupported exactly-once or inbox-delivery guarantee is made.

---

## 🧪 Validation Plan

**Manual tests**

- Staging verification/reset links, paid checkout → email → shipment → email,
  cancellation/refund wording, inbox appearance, authorized sender/DNS, alert
  routing, outage recovery, operator replay, and backup restoration.

**Automated tests**

- Real Redis/captured SMTP plus both database providers; meaningful failing-test
  cycles for each slice and the required full checks in step 6.
- Review focus: auth persistence failure without account enumeration (step 3),
  stale leases/Redis loss (steps 1–2), late payment after cancellation (step 4),
  SMTP acceptance before worker death (steps 2/5), and key rotation/expiry cleanup
  (steps 1/5). Each has a named behavior case above.

**Rollback / mitigation**

- Use additive migrations and preserve pending ledger rows. Disable new order
  notification production and stop/drain workers before rollback; reconcile
  queued auth before restoring inline mode. Never auto-reset databases or send
  historical notifications to compensate for a failed deployment.

---

## ⚠️ Risks & Open Questions

**Risks**

- **Risk:** SMTP cannot provide exactly-once submission — _Mitigation:_ durable
  claims/budgets, explicit UNCERTAIN state, reviewed replay acknowledging duplicates.
- **Risk:** Auth callback is outside token/user transaction — _Mitigation:_ await
  durable insert, characterize framework behavior, retain generic responses and
  resend/reset recovery; document the pre-insert crash window.
- **Risk:** Aggregate provider limits or Redis/key failure disrupt delivery —
  _Mitigation:_ one worker initially, bounded queues, durable reconciliation,
  alerts, tested rotation, and shared limits before scaling replicas.

**Open questions** _(blockers for implementation)_

- None for isolated implementation with test services. Deployment owner must
  provide production Redis/SMTP services, account limits, sender/DNS access,
  secrets, HTTPS origins, and monitoring routing before production cutover.
