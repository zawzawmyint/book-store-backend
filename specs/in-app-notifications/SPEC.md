# 🔔 In-app Notifications Backend Specification

> **Goal:** Persist useful customer and workspace notifications and signal connected browsers through Redis Pub/Sub and authenticated SSE.

**Status: Proposed — implementation is delivered and local verification is recorded, but acceptance remains incomplete.**
**Date:** 2026-10-20. **Branch:** `feat/in-app-notifications`.
Companion: [frontend contract](../../../frontend/specs/in-app-notifications/SPEC.md).
Delivery: [coordinated implementation plan](../../docs/superpowers/plans/2026-10-20-in-app-notifications.md).
The interface and limits below describe the delivered implementation. The status remains Proposed until production staging verifies Redis TLS/ACLs, streaming proxy behavior and capacity, and scheduled retention cleanup.

---

## 🎯 Objective

Give customers a durable order-update inbox and Staff/Admin an actionable operational inbox. Redis and SSE carry invalidation signals, while GraphQL reads authoritative database state. Notification failure must never fabricate a completed order, payment, shipment, or refund.

---

## 📦 Scope

**In scope**

- Per-recipient notifications, unread counts, cursor pagination, idempotent read operations, storefront/workspace separation.
- Customer kinds: `PAYMENT_CONFIRMED`, `ORDER_ACCEPTED`, `ORDER_SHIPPED`, `ORDER_DELIVERED`, `ORDER_CANCELLED`, `REFUND_COMPLETED`.
- Workspace kinds: `NEW_PAID_ORDER`, `STOCK_LOW`, `STOCK_OUT`, `REFUND_FAILED`; the last kind is Admin-only.
- Redis Pub/Sub across API instances; same-origin authenticated SSE; bounded recovery fetching; SQLite/PostgreSQL parity.

**Out of scope**

- OS/browser push, service workers, Socket.IO, GraphQL subscriptions, online presence, email suppression, notification preferences, sounds, promotional messages, automatic carrier tracking, back-in-stock subscriptions, and historical backfill.
- Changing existing email semantics, live-payment support, or resolving unrelated release gates. Existing Stripe test-mode restrictions remain.

---

## ⚙️ Assumptions & Constraints

**Technical**

- Reuse Express, Better Auth, Apollo, Drizzle, `ioredis`, existing Redis, and native browser `EventSource`; no new production package is expected.
- Redis is an optional API connection only when notification live delivery is enabled. Queued email mode otherwise keeps Redis in the separate email worker.
- Database writes and notification inserts share the domain transaction; no Redis calls inside database transactions.
- Existing `NotificationRow` / `NotificationDraft` in `src/database/store.types.ts` refer to email records. New types must use `InAppNotification*` names and a separate table.
- API instances share one database and one deployment-specific Redis channel prefix. Each instance subscribes once, with dedicated publisher/subscriber connections, never borrowed from BullMQ.

**Product / Business**

- Storefront inbox belongs to the verified account, including Staff/Admin shopping as customers. Workspace inbox requires current Staff/Admin authorization.
- Recipient set is snapshotted from verified, eligible accounts in the domain transaction. Newly promoted staff receive future alerts only. Each recipient has their own row/read state.
- Retention is 90 days for read and unread rows, with visible history-limit copy; no historical import. Cleanup runs as an explicit maintenance command, not a new always-running service.

**Dependencies**

- Same-origin proxy for `/api/notifications/*`, TLS in production, streaming-compatible hosting and a shared deployment-specific channel prefix.
- Reviewed production stream capacity/proxy behavior remains an operational acceptance requirement; no capacity claim follows from using Redis.

---

## 🧩 Delivered Approach

**Business events and recipients**

- `PAYMENT_CONFIRMED`: first verified transition to PAID, customer owner only, even if cancellation already occurred; wording is a receipt, not acceptance. `NEW_PAID_ORDER`: same transition, but only for an order still eligible for preparation; snapshot current Staff/Admin recipients. No unpaid/expired checkout alerts to staff.
- `ORDER_ACCEPTED`, `ORDER_SHIPPED`, `ORDER_DELIVERED`: actual committed transitions to Preparing/Shipped/Delivered; customer owner only. Request attempts and repeated status submissions produce nothing.
- `ORDER_CANCELLED`: actual committed cancellation, including payment expiry; tell the customer when no payment was collected versus a refund processing/required. Never promise a completed refund prematurely. A later late-payment receipt remains a separate payment event, without another cancellation alert.
- `REFUND_COMPLETED`: first confirmed REFUNDED transition, owner only. `REFUND_FAILED`: transition into REFUND_FAILED, current Admin recipients only; no transient provider/network-retry alerts. A later retry that genuinely fails again creates a new failure episode.
- Stock bands: `HEALTHY` (>5), `LOW` (1–5), `OUT` (0). On an active book, emit only when entering LOW or OUT from a different band. Replenishment 0→3 therefore emits LOW; 4→2 does not; >5 replenishment rearms future LOW alerts. Ignore new-book opening stock, seed/migration operations, archived-book changes, and archive/restore itself.
- Observe stock changes from staff adjustments, checkout reservations, legacy order writes, and cancellation/expiry restoration. Use locked before/after values in the actual transaction; a rolled-back or no-op change creates nothing. Alerts describe stock at event time; linked inventory is current.
- Snapshot event identity once and enforce unique `(eventKey, recipientId, scope)`. Order lifecycle keys use order ID + transition kind for one-time milestones. Stock/failure episode keys reuse a persisted transition/operation identity on retries; never a fresh webhook-attempt UUID. Concurrency must not duplicate the same transition.
- Recipient insertion failure rolls back the domain transaction. Zero eligible workspace recipients is valid. Live publish failure after commit never rolls back or changes the business response.

**Storage**

- `in_app_notifications` stores UUID `id`, bounded `eventKey`, `recipientId` (existing user ID, cascading deletion), `scope` (`STOREFRONT | WORKSPACE`), kind, `requiredRole` (`VERIFIED | STAFF | ADMIN`), `resourceType` (`ORDER | BOOK`), resource ID, versioned allowlisted presentation payload, UTC creation timestamp, and nullable UTC `readAt`.
- Payload contains only order number/book-title snapshot, event-time stock, and cancellation refund phase as needed. No email tokens, addresses, provider secrets, raw errors, arbitrary URLs, or HTML. Bound book-title snapshots to 256 characters. Serialize timestamps as ISO-8601 strings in GraphQL.
- Unique dedupe index above; indexes supporting recipient/scope/creation+ID ordering, unread filtering, and retention. Enumerate equivalent schema/check constraints in both database providers. Resource IDs remain snapshots when records disappear; no cascading deletion by order/book.
- Sort descending by `(createdAt, id)` with keyset pagination. Cursor is a validated opaque encoding of that tuple, scoped in every query by current recipient and authorized inbox. Notification IDs never confer ownership.
- Read-all is one database statement affecting currently visible authorized rows at statement snapshot. New rows committed afterward stay unread. Read-one is idempotent and retains the first read timestamp. Ownership failures use the same not-found outcome as nonexistent IDs.
- `notifications:cleanup` deletes rows strictly older than 90 days in batches of at most 500, with a cutoff captured once per invocation; preserve newer rows and email records. Document daily execution by the hosting scheduler and metrics for deleted rows. Do not require cleanup to run before normal reads.

**Additive GraphQL contract**

- `NotificationScope`: `STOREFRONT | WORKSPACE`.
- `InAppNotification`: `id: ID!`, `kind: InAppNotificationKind!`, `scope: NotificationScope!`, `createdAt: String!`, `readAt: String`, `resourceType: NotificationResourceType!`, `resourceId: ID!`, `bookTitle: String`, `stockAtEvent: Int`, `refundPhase: NotificationRefundPhase`, `testPayment: Boolean!`.
- Kinds are the ten values listed under Scope. Resource types: `ORDER | BOOK`. Refund phases: `NONE | PROCESSING | SUPPORT | COMPLETED`; nullable outside relevant order messages. `testPayment` uses the saved order context; book alerts use false. Keep test-payment wording accurate.
- `notifications(scope: NotificationScope!, first: Int = 20, after: String, unreadOnly: Boolean = false): InAppNotificationConnection!` with `nodes`, `pageInfo { endCursor, hasNextPage }`.
- `notificationUnreadCount(scope: NotificationScope!): Int!`, exact count capped only for UI display.
- `markNotificationRead(id: ID!, scope: NotificationScope!): InAppNotification!`.
- `markAllNotificationsRead(scope: NotificationScope!): NotificationReadResult!`, returning `changedCount: Int!`; frontend refetches authoritative count.
- Validate `first` in 1–50, cursor length ≤512 and decoded shape/types. Reuse existing `UNAUTHENTICATED`, `FORBIDDEN`, `BAD_USER_INPUT`, and not-found conventions rather than leaking raw database errors; check actual shared error mappings during implementation.
- Current verified session required; derive recipient exclusively server-side. Workspace queries/counts/mutations always recheck current role and filter Admin-only kinds for Staff, including rows issued before demotion. Demotion hides workspace history; re-promotion restores still-retained authorized history, without backfill.
- Publish a read-state invalidation after successful read mutations so other tabs/devices refresh; duplicate hints are harmless. No order-resource auto-refetch is promised by this feature.

**Redis and configuration**

- `IN_APP_NOTIFICATIONS_ENABLED=false` gates producers, API GraphQL access, and stream mounting; `NOTIFICATION_LIVE_ENABLED=false` gates only Redis/SSE. Enabling live while the feature is off is a configuration error. Disabled GraphQL fields return a stable `NOTIFICATIONS_DISABLED` extension code.
- `NOTIFICATION_CHANNEL_PREFIX` defaults to `book-store-development` outside production; require an explicit 1–100 character `[A-Za-z0-9_-]` prefix in production when live is enabled. Use `${prefix}:notifications:changed`.
- Live enabled requires existing `REDIS_URL`; production requires authenticated verified `rediss:`. Reuse URL-validation policy without coupling notification configuration to email payload keys or worker startup. Existing email configuration remains independent.
- Payload: `{ version: 1, recipientId: string, scope: "STOREFRONT" | "WORKSPACE" }`, maximum encoded size 1 KiB; subscriber validates before dispatch. IDs/scopes are internal signals, never authorization grants. Publish after commit from every event producer and after reads; nested transactions must not publish before the outermost commit.
- No persisted live-signal queue, replay, or delivery guarantee. Crash between commit and publish is recovered by fetching. Redis outages log redacted operational events and reconnect with bounded buffering disabled; GraphQL inbox and business transactions stay available. API `/ready` continues reflecting database readiness; report live transport degradation separately.

**SSE contract and lifecycle**

- `GET /api/notifications/stream?scope=STOREFRONT|WORKSPACE` uses same-origin session-cookie auth, with no user ID or bearer token in the URL. It uses the same verified-session policy as GraphQL, requires the current workspace role for WORKSPACE, validates scope before opening, and returns 401/403/400 as applicable, 404 when disabled and 503 when live is disabled or the Redis subscriber is not ready.
- Register the connection before flushing `event: ready\ndata: {}\n\n`; frontend refetches on ready. Stream `event: notifications-changed\ndata: {}\n\n` only; no private payload, count or resource ID. Browser fetches authorized data through GraphQL. Subscriber reconnect emits invalidation to current connections to trigger reconciliation.
- Headers: `Content-Type: text/event-stream`, `Cache-Control: no-store, no-transform`, `X-Accel-Buffering: no`; flush headers, disable compression/buffering for this route. Send `retry: 5000` and comment heartbeat every 15 seconds. No replay cursor or Last-Event-ID guarantee.
- Revalidate current session and workspace eligibility at least every 30 seconds, without stale cookie/session-role cache; close on expiry/logout/revocation. Frontend session transitions close immediately. No private business data travels through hints; GraphQL always reauthorizes.
- Per-process limits are 5 streams per user and 500 streams total; return 429 before opening beyond limits. Close slow clients after 5 seconds of unresolved write backpressure; coalesce invalidations rather than unbounded buffering. Clean listeners/timers/registrations on abort. Shutdown closes streams before draining HTTP and closes both Redis connections. Capacity/load-balancer settings must be reviewed in staging.
- Same-origin deployment only for v1: reject foreign Origin when present, no wildcard credentialed CORS. Proxy the exact route in Vite and production, preserving cookies/streaming. No sticky session requirement when all API instances subscribe to shared Redis; clients refetch on reconnect to any instance.

**Delivered files**

- [Store types](../../src/database/store.types.ts), [SQLite schema](../../src/database/schema.ts), [PostgreSQL schema](../../src/database/postgresql/schema.ts), both provider stores, and generated migrations define the persisted inbox.
- The [payment repository](../../src/modules/payments/payment.repository.ts) supplies persisted refund operation identity to the wrapper; the wrapped store observes order and stock mutations transactionally.
- [App composition](../../src/app.ts), [server lifecycle](../../src/server.ts), GraphQL schema/resolvers, configuration, and `.env.example` wire the feature.
- `src/modules/notifications/notification.{types,validation,writer,repository,schema,resolvers,config,live,sse,cleanup-cli}.ts` implement the feature with a bounded SSE registry and Redis lifecycle.

**References**

- [Redis Pub/Sub semantics](https://redis.io/docs/latest/develop/pubsub/) — best-effort signals.
- [MDN SSE](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) — event framing, reconnection and proxy considerations.

---

## 🚀 Delivery record

1. **Persistence and access** — additive SQLite/PostgreSQL migrations, ownership/role-filtered GraphQL APIs, independent read state, and `notifications:cleanup` are delivered.
2. **Domain producers** — `createNotificationStore` wraps mutation paths so durable notification rows share their outer business transaction; publish follows commit. Refund failure uses the explicit persisted `refundOperationId` context supplied by `failOperation`.
3. **Live transport and UI** — dedicated ioredis publisher/subscriber connections, native SSE, scoped React bells/inboxes, and four-language RTL support are delivered.
4. **Acceptance** — local tests pass; staging deployment evidence remains open as listed below.

---

## ✅ Acceptance Criteria

**Functional**

- [ ] All ten kinds follow the exact trigger/recipient rules; payment expiry, late payment on cancelled orders and repeated failure episodes are correct.
- [ ] Every recipient has independent read state; query/mutation ownership and current-role filtering agree with counts.
- [ ] Duplicated webhooks, jobs, stock retries and rolled-back transactions produce no duplicate or false records.
- [ ] Cursor pagination and read-all races preserve new arrivals; retention and account deletion behave as specified.
- [ ] Two API instances receive committed creation/read signals and notify only matching user/scope connections.
- [ ] Independent feature/live flags, disabled responses and existing email behavior match the contracts.

**Non-functional** (performance, security, accessibility, reliability)

- [ ] Redis/SSE outage cannot lose saved inbox data or fail committed business actions; fallback fetching converges.
- [ ] Session revocation/demotion, malformed messages, unauthorized streams and slow clients are tested; stream resources remain bounded and cleaned.
- [ ] Production credentials/channel isolation, proxy streaming, HTTP/2 browser connections, process shutdown and observed connection limits are verified in staging.
- [ ] No private payload or secret is logged or emitted in SSE; database queries use bounded limits and reviewed indexes.

---

## 🧪 Validation Plan

**Manual tests**

- Customer and staff browsers: pay in test mode, prepare, ship, deliver; separately cancel/refund, inspect book thresholds and Admin-only failures. No production recipients/payments.
- Route a mutation to API A while SSE is attached to B; repeat reads across tabs. Disconnect Redis, restart APIs, revoke sessions/demote staff, verify recovery and absence of leaked data.
- Verify production proxy delivers heartbeats promptly and native browser reconnect works without page reload; review actual resource counts under expected concurrency.

**Automated tests**

- Real isolated SQLite/PostgreSQL tests for migration preservation, event transitions/dedupe/concurrency/rollback, cursor queries, roles, read races and 90-day cutoff.
- Real isolated Redis and two API processes for validated fanout, read hints, reconnect and outage recovery; negative SSE auth, connection cap/backpressure and shutdown tests. Test runner must refuse non-loopback Redis and use a unique channel prefix; never FLUSHDB or disrupt email queues.
- Backend `bun run test`, `bun run test:postgres`, `bun run lint`, `bun run build`, codegen drift checks; existing `bun run test:email` using documented isolated Redis settings.
- Frontend checks and coordinated browser suites follow the companion specification; test outcomes must be recorded after execution, not inferred from this document.

**Rollback / mitigation**

- Deploy additive backend schema/code first with both flags off, then compatible frontend; enable producers after migration readiness. Enable live only after Redis/proxy checks. Frontend runtime capability handling hides disabled feature without breaking existing pages.
- Disable live to retain inbox fetching, or disable the full feature to stop new records and hide UI. Retain tables on binary rollback; do not edit existing email ledger or destructive down-migrate. Back up persistent databases before migration and preserve matching cover backups.

## 🛠️ Activation and operations

Apply the generated SQLite and PostgreSQL migrations with `bun run db:migrate` before enabling this feature. Deploy compatible backend and frontend builds with both flags off first. Set `IN_APP_NOTIFICATIONS_ENABLED=true` only after migration readiness; set `NOTIFICATION_LIVE_ENABLED=true` only after setting `REDIS_URL` and `NOTIFICATION_CHANNEL_PREFIX`. Live mode requires a shared channel prefix and Redis connection; production requires an explicit prefix plus authenticated `rediss:` TLS. The API connects to Redis only when live notifications are enabled. Queued email delivery remains independent and adds no Redis requirement to the API by itself.

Proxy `/api/notifications/stream` same-origin without response buffering or compression, preserve cookies, and support long-lived streaming connections. Run `bun run notifications:cleanup` from the hosting scheduler daily; it captures one cutoff and deletes only notification rows older than 90 days in batches of 500. Run `bun run test:notifications:live` only with its isolated loopback Redis settings; it neither uses production Redis nor flushes shared data.

Staging must still demonstrate the production Redis TLS/ACL configuration, proxy heartbeats/reconnects and capacity limits, and successful scheduled cleanup before the feature can move from Proposed to Implemented.

---

## ⚠️ Risks & Open Questions

**Risks**

- **Risk:** Missing stock write path or publishing before outer commit — _Mitigation:_ enumerate every stock mutation and transaction owner; verify rollback and concurrent writers in both providers.
- **Risk:** Large staff recipient fanout adds transaction latency — _Mitigation:_ batch inserts for the current small workspace, measure realistic staff counts; reassess outbox-based fanout if staffing scale requires it.
- **Risk:** Pub/Sub loss or connection limits delay updates — _Mitigation:_ database-authoritative fetching, recovery refresh, bounded streams and production capacity review.
- **Risk:** User/role changes expose old alerts — _Mitigation:_ authorize every GraphQL operation, filter sensitive kinds and periodically recheck SSE sessions.

**Open questions** _(blockers for implementation)_

- No local implementation ambiguity remains. Before production enablement, confirm hosting streaming/timeouts/capacity, channel prefix, Redis ACL/TLS access, and a daily retention-command scheduler. Review the 90-day retention and stream limits with the owner before launch.
