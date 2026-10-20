# 🧭 In-app Notifications Implementation Plan

> **Goal:** Deliver a durable customer/workspace notification inbox with Redis Pub/Sub invalidations, SSE delivery and GraphQL fetching across both repositories.

**Status: Proposed — implementation delivered; acceptance incomplete.**
**Date:** 2026-10-20. Both repositories use `feat/in-app-notifications`, based on backend `58c663c` and frontend `6f2fb92`.
**Specifications:** [backend](../../../specs/in-app-notifications/SPEC.md), [frontend](../../../../frontend/specs/in-app-notifications/SPEC.md).
The implementation now exists in both repositories. This plan remains the coordinated design and delivery record until production staging supplies the remaining TLS, proxy/capacity, and scheduled-retention evidence.
The task checklists below are the original implementation plan, retained as planning history; [the frontend verification record](../../../../frontend/specs/in-app-notifications/VERIFICATION.md) records observed delivery evidence and must be used for acceptance status.

---

## 🎯 Objective

Extend the existing payment, fulfillment and inventory workflow with useful saved notifications in both shells. Keep business truth in the database, email jobs in the existing email system, live invalidation in Redis/SSE, and reads/read-state mutations in GraphQL.

---

## 📦 Scope

**In scope**

- Ten notification kinds and recipient/transition rules in the backend spec; independent storefront/workspace read state.
- Additive SQLite/PostgreSQL migrations, authorized GraphQL APIs, dedicated Redis publisher/subscriber and authenticated SSE.
- Shared bell, history pages, generated operations, four languages/RTL, recovery and release controls.

**Out of scope**

- Browser/OS push, Socket.IO, GraphQL subscriptions, online presence, changed emails, live Stripe support and unrelated refactoring.
- Additional event broker/outbox infrastructure for best-effort live signals; durable inbox writes already preserve the notification itself.

---

## ⚙️ Assumptions & Constraints

**Technical**

- Bun 1.3.14 and Node.js 24+ as existing repository requirements. Reuse installed packages and native EventSource; inspect applicable AGENTS.md again at implementation.
- Specifications remain Proposed until actual acceptance evidence is recorded. No runtime dependencies or production resources are created by this plan.
- TDD for behavior: choose one observable criterion, write a focused failing test, confirm intended failure, implement minimally, verify, then proceed. Use real isolated databases for persistence/transactions.
- Preserve existing email record names; add `InAppNotification*` types. No Redis/SMTP calls while domain transactions are open; publication only after outer commit.
- Shared constants: stock LOW 1–5 / OUT 0; recent feed 10, history page 20, maximum API page 50; 90-day retention, cleanup batch 500; heartbeat 15s, session recheck ≤30s; 5 streams/user/process and 500/process; backpressure timeout 5s; frontend coalescing 250ms, recovery 60s with initial jitter ≤5s; 3 consecutive SSE errors then 5-minute retry.

**Product / Business**

- No historical backfill; snapshot eligible recipients at event time. Current permissions control access on every request. Staff see their own customer inbox separately from workspace alerts.
- Stock notifications are event snapshots, not tasks requiring resolution; no automatic deletion when stock recovers. Existing alert history stays until retention/account deletion.

**Dependencies**

- Compatible backend deployed/migrated before frontend enablement; shared TLS Redis channel, same-origin streaming proxy and daily cleanup scheduler before production.
- Backend is the API contract authority; frontend GraphQL codegen must use the coordinated schema.

---

## 🧩 Proposed Approach

**Architecture and data flow**

- Commit domain state + per-recipient notification rows in one transaction. After commit publish a small recipient/scope hint. Each API process subscribes and signals its authenticated SSE clients. Browser refetches using Apollo/GraphQL. Read changes use the same invalidation path; periodic fetching recovers missing signals.
- Feature and live flags are independent. Redis unavailability degrades live delivery without breaking durable reads or committed order outcomes.

**Existing components to change**

- Backend: [store contract](../../../src/database/store.types.ts), [SQLite schema](../../../src/database/schema.ts), [PostgreSQL schema](../../../src/database/postgresql/schema.ts), [SQLite store](../../../src/database/sqlite/store.ts), [PostgreSQL store](../../../src/database/postgresql/store.ts).
- Producers: [payments](../../../src/modules/payments/payment.repository.ts), [admin order workflow](../../../src/modules/orders/admin-order.repository.ts), [legacy order creation](../../../src/modules/orders/order.repository.ts), [admin books](../../../src/modules/books/admin-book.repository.ts).
- Composition: [app](../../../src/app.ts), [server](../../../src/server.ts), [GraphQL schema](../../../src/graphql/schema.ts), [resolvers](../../../src/graphql/resolvers.ts), [configuration](../../../src/config/env.ts).
- Frontend: [routes](../../../../frontend/src/app/App.tsx), [storefront layout](../../../../frontend/src/app/Layout.tsx), [workspace layout](../../../../frontend/src/features/admin/AdminLayout.tsx), [session boundary](../../../../frontend/src/app/SessionBoundary.tsx), [operations](../../../../frontend/src/operations.graphql), [proxy](../../../../frontend/vite.config.ts), four locale namespace sets.
- New planned modules live in backend `src/modules/notifications/` and frontend `src/features/notifications/`; exact responsibilities follow the tasks below. Generated migration filenames are determined by Drizzle, not invented here.

**API/data changes**

- Add `in_app_notifications` table, notification kinds/scopes/resource/refund enums, list/count queries and read-one/read-all mutations as specified verbatim in the backend contract.
- Add `/api/notifications/stream?scope=...`; event names `ready` and `notifications-changed`, data `{}`; no private payload or replay guarantee.
- Delivered config: `IN_APP_NOTIFICATIONS_ENABLED`, `NOTIFICATION_LIVE_ENABLED`, `NOTIFICATION_CHANNEL_PREFIX`; reuse `REDIS_URL`. Frontend flag `VITE_IN_APP_NOTIFICATIONS_ENABLED`. Defaults are off; the API connects to Redis only when live delivery is enabled.

---

## 🚀 Execution Plan

### 1. **Persistence and authorized inbox** — _(role: backend)_

**Files:** Create `src/modules/notifications/notification.{types,validation,repository,schema,resolvers,config}.ts` and `test/in-app-notifications.test.ts`; extend both schemas/stores, store types, GraphQL composition, `.env.example` and generated resolvers. Read the existing database-support spec first.

**Interfaces:** Export `NotificationScope`, `InAppNotificationKind`, `InAppNotificationDraft`, `InAppNotificationRow`; repository methods `list(userId, scope, input)`, `unreadCount(userId, scope)`, `markRead(userId, scope, id)`, `markAllRead(userId, scope)`. `input` is `{ first: number; after?: string; unreadOnly: boolean }`. Authorization uses fresh current role; repository cannot return forbidden Admin kinds. GraphQL names and result shapes follow the backend spec exactly.

- [ ] Write failing migration/persistence tests preserving populated orders/email records; include ownership, unverified access, staff demotion, Admin-only count filtering, repeated reads, malformed cursor/page limits and read-all concurrent arrivals.
- [ ] Run `bun run test -- in-app-notifications`; confirm the missing API/storage behavior fails, not fixture setup.
- [ ] Add logical types, generated additive migrations for both providers, indexes, scoped keyset queries and authorization. Add independent configuration/disabled-feature responses with no email-key coupling.
- [ ] Generate resolver types with `bun run codegen`; rerun focused tests and disposable PostgreSQL parity coverage. Check unchanged email types and no schema drift. Commit reviewed persistence/API slice.

### 2. **Transactional domain producers** — _(role: backend)_

**Files:** Create `notification.writer.ts` and `test/in-app-notification-events.test.ts`; modify payment/order/admin-book repositories, store adapters and internal dependency wiring. Inspect every `adjustStock` call and the actual payment transition/operation identities before editing.

**Interfaces:** `createNotificationWriter(...)` supplies `writeOrderEvent(tx, { eventKey, kind, orderId })` and `writeStockTransition(tx, { eventKey, bookId, beforeStock, afterStock })`; both return recipient/scope hints only for newly inserted rows. `tx` is the existing `DomainStore`; keys must be stable per domain transition. Transaction owners collect hints and publish only after successful outer commit through the optional task-3 publisher (no-op while live is disabled). Do not attach arbitrary global mutable transaction buffers.

- [ ] Write failing event tests: paid customer receipt + staff actionable order; cancelled-before-late-payment gets receipt but no preparation alert; accepted/shipped/delivered; expiry cancellation phase; confirmed refund; failure→retry→failure episodes; zero workspace recipients; per-staff read independence.
- [ ] Add stock transition tests for 6→5, 5→4, 1→0, 0→3, 3→6→5, reservation/expiry restoration, no-op/archived/create/seed exclusions and concurrent writers. Rollback must remove both domain writes and notifications. Replay provider events must dedupe.
- [ ] Run targeted test files and verify failures refer to missing notification outcomes.
- [ ] Implement transactional notification writes independent of email flags; snapshot recipients and allowlisted payload; enforce unique event/recipient/scope identity and provider parity. Audit outermost commit ownership and ensure live failures never alter commit results.
- [ ] Verify targeted suites and PostgreSQL parity. Record complete stock mutation-path inventory in the backend spec and commit the producer slice.

### 3. **Redis bridge and secure SSE** — _(role: backend)_

**Files:** Create `notification.live.ts`, `notification.sse.ts`, `test/notification-live.test.ts`, `scripts/test-notification-live.ts`; extend app/server lifecycle/config/logger allowlists as needed, package scripts and `.env.example`. Reuse `ioredis`; no new production package.

**Interfaces:** `createNotificationLive(config)` returns `{ start(), publishChanged(hints), subscribe(listener), close() }`; `publishChanged` consumes `{ recipientId, scope }[]`, validates/coalesces and never throws into an already committed business response. Mount route with session resolver derived from the same Better Auth instance. SSE registry is process-local and keyed by authenticated recipient/scope. No caller-chosen user identity.

- [ ] Write failing real loopback Redis tests with unique channel prefixes: publication from API A reaches SSE on API B, duplicate hints are harmless, read changes cross instances, malformed/oversized/foreign-prefix messages are ignored, disconnect/reconnect recovers through GraphQL and ready/invalidation.
- [ ] Write endpoint tests for 401/403/400/404/503/429, cookie auth, foreign Origin, revoked session, demotion, 15s heartbeat, slow-reader closure, cleanup after abort, no private frame content, and shutdown with open streams.
- [ ] Confirm intended failures; implement dedicated publisher/subscriber lifecycle, startup degradation, bounded connections, authentication checks and stream framing from the backend spec. Disable route buffering/compression and close streams before draining the server.
- [ ] Add `test:notifications:live` script invoking the isolated runner, validating loopback Redis config and spawning two disposable APIs with no development DB access. Runner must never FLUSHDB; close its own connections and fixtures.
- [ ] Run `bun run test:notifications:live` plus targeted auth/config tests. Simulate Redis down at startup and after commit; verify GraphQL works and `/ready` remains database-based. Commit transport slice.

### 4. **Frontend data lifecycle and shared inbox** — _(role: frontend)_

**Files:** Create `src/features/notifications/{NotificationProvider.tsx,NotificationBell.tsx,NotificationList.tsx,NotificationsPage.tsx,use-notification-feed.ts,notification-links.ts}` and focused tests; extend operations/generated types, layouts/routes, proxy, locale files and `.env.example`.

**Interfaces:** Provider owns verified account/scope generation, one active stream and fallback timers. `useNotificationFeed(scope)` exposes authoritative count/count-error, page data/loading/error, load-more/filter controls, `markRead(id)`, `markAllRead()` and pending states; derive generated types from operations. Bell/page share the same provider and avoid duplicate streams.

- [ ] Against the task-1 running backend, add operations and run `bun run codegen`; validate schema compatibility before UI implementation.
- [ ] Write failing lifecycle tests: ready reconnect refetch; 250ms burst coalescing with one trailing fetch; hide/show timers; three-error cutoff/five-minute retry; delayed old-account response rejection; scope changes; disabled capability and role loss.
- [ ] Implement same-origin EventSource listener + Apollo recovery and session-bound cleanup; proxy `/api/notifications` to backend. Preserve existing cart/session boundaries and do not claim EventSource exposes HTTP error statuses.
- [ ] Write failing UI tests for badge/unknown count, safe destinations, unknown kind, read failure navigation, read-all race/count refresh, unread filter/pagination and guest/role gating.
- [ ] Implement shared bell/dialog/mobile Sheet and two inbox routes, all translated copy and test-payment qualifiers, retention explanation, keyboard/focus handling and RTL. Follow existing visual primitives; do not add a UI framework.
- [ ] Run focused tests, frontend unit/lint/build and codegen drift check; commit frontend slice with spec alignment.

### 5. **Retention, deployment and connected verification** — _(role: fullstack)_

**Files:** Create backend `notification.cleanup-cli.ts` and retention tests; add `notifications:cleanup` command. Extend frontend isolated browser harness and proposed `e2e/notifications.spec.ts`; backend live runner remains test-only. Update both READMEs, root SPECs, feature specs and verification record `frontend/specs/in-app-notifications/VERIFICATION.md` only with real results.

**Interfaces:** Cleanup uses existing configured database, captures one UTC cutoff, deletes batches ≤500 strictly older than 90 days and exits cleanly. Daily external scheduler runs the command; no new runtime cron dependency. Browser fixtures enable the feature, inject independent loopback Redis/config and refuse shared development/production data.

- [ ] Write and run failing retention boundary/batching tests (read/unread, exactly-at-cutoff preserved, email ledger untouched), implement the command, then verify both providers.
- [ ] Add browser journeys for test payment→staff bell→prepare/ship→customer bell→order link, scoped counts, independent staff reads, Admin-only refund alert, logout/switch isolation and fallback after a missed live hint. Domain edge cases remain backend integration tests.
- [ ] Run required backend/frontend checks listed under Validation Plan and capture commands, pass/failure summaries and limitations. Fix failures before making success claims.
- [ ] Manually verify keyboard, 375px mobile, native 200% zoom, both themes, four languages/RTL, two API instances, Redis outage/recovery and revoked access. Record staging proxy/heartbeat behavior and chosen capacity limits separately from local evidence.
- [ ] Reconcile documentation after tests settle; delegate final documentation reconciliation to the global `spec-updater` when available, with ownership of both root SPECs/READMEs and feature/verification docs, wait for its report and inspect diff. No concurrent edits to its assigned docs. Keep unchecked/manual criteria Proposed if not verified.
- [ ] Review migration and deployment order: backup → migrate additive schema → compatible backend with flags off → frontend flag off → enable feature in staging → verify → enable frontend/live → production enablement only after operational acceptance. Review code and concrete evidence before integration; do not deploy as part of this documentation request.

---

## ✅ Acceptance Criteria

**Functional**

- [ ] Backend and frontend specifications are fulfilled with all event triggers, scope/recipient isolation, read state, paging, retention and disabled modes verified.
- [ ] Customer/staff journey works across two API processes without duplicate messages; lost signals reconcile from database state.
- [ ] Email queues and existing checkout/inventory behavior remain correct; test-payment restrictions remain intact.

**Non-functional** (performance, security, accessibility, reliability)

- [ ] Authorization/revocation, bounded streaming resources, burst control and no private SSE payload are verified.
- [ ] All supported language/theme/mobile/zoom/accessibility checks pass with recorded limitations.
- [ ] Production streaming/proxy/TLS/channel/capacity and daily retention schedule have explicit operational evidence before enablement.

---

## 🧪 Validation Plan

**Manual tests**

- Follow both specs' connected journeys and recovery scenarios; test actual proxy and two processes rather than treating mocked transport tests as cross-instance proof.
- Compare scopes for a Staff/Admin account shopping personally and working in admin; revoke access while a stream is open.
- Inspect native 200% zoom and RTL, focus restoration, stale alert text, unavailable targets and no misleading unread count on request failure.

**Automated tests**

- Backend: focused new integration tests, `bun run codegen`, `bun run test`, `bun run test:postgres`, `bun run test:notifications:live` (new planned script), existing `bun run test:email` with documented loopback Redis config, `bun run lint`, `bun run build`.
- Frontend: codegen against matching backend, `bun run test`, `bun run lint`, `bun run build`, `bun run test:e2e`; backend `bun run test:postgres:browser` for coordinated parity.
- Repeat/broaden checks only after new changes, failures or unresolved concerns. Required evidence covers rollback, concurrency and role isolation, not internal helper implementation details.

**Rollback / mitigation**

- Live off preserves database inbox/fallback. Full feature off stops producers/API use and frontend capability hides feature. Keep additive tables on rollback and preserve email workers.
- Failed migrations block enablement; restore matching backup only through an explicit reviewed operation. No automatic reset or production seeding.

---

## ⚠️ Risks & Open Questions

**Risks**

- **Risk:** Commit/publish race or Redis loss — _Mitigation:_ saved inbox plus connect/visibility/60s reconciliation; never promise guaranteed live delivery.
- **Risk:** Inventory paths or repeated refund episodes dedupe incorrectly — _Mitigation:_ persisted transition identities, every write-path inventory and concurrency tests.
- **Risk:** Long-lived streams retain permissions/resources — _Mitigation:_ periodic fresh session checks, authorization at GraphQL reads, bounded buffers/connections, cleanup/shutdown tests.
- **Risk:** Fanout and browser connection limits exceed expected scale — _Mitigation:_ measure staff counts/stream concurrency, HTTP/2 proxy, one visible-tab connection and fallback fetching.

**Open questions** _(blockers for implementation)_

- No unresolved local functional blocker remains. Production enablement still needs hosting/proxy confirmation, Redis TLS/ACL/channel configuration, retention scheduler and capacity review. Owner can revise retention/limits or notification copy during document review before enabling the feature.
