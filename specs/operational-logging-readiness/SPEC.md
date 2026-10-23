# Operational logging and readiness

**Status: Implemented**

## Purpose

Make backend failures observable in local terminals and hosting log collectors,
and let a hosting health check determine whether the API can access its required readiness dependencies.
Logs support diagnosis; persisted orders and payment evidence remain authoritative.
This feature is backend-only and independent of a hosting provider.

## Scope and boundaries

- Structured JSON console logging, HTTP request correlation, GraphQL outcomes,
  payment/recovery failures, auth-email outcomes, database connection failures,
  and server lifecycle events.
- A public, read-only `GET /ready` endpoint for SQLite and PostgreSQL, plus the auth limiter's Redis PING when that independent mode is configured.
- Preserve `GET /health`, authentication, authorization, payments, retries,
  inventory transactions, and GraphQL response contracts.
- No log-file storage, log database, admin log viewer, telemetry vendor integration,
  automatic alerts, deployment, live-payment enablement, or database migration.
- No new external dependency is required for this initial scope.

## Logging contract

Emit one JSON object per line. Info events use stdout; warnings and errors use
stderr. Required fields are UTC ISO `timestamp`, `level` (`info`, `warn`, `error`),
and a fixed application-owned `event` name. Include `environment` and component
where supplied by application startup. Allowlisted context includes generated
request IDs, normalized routes, methods, HTTP status, elapsed milliseconds,
validated GraphQL operation names, safe error codes, and internal order IDs.

Generate a fresh server-owned request ID for every HTTP request and return it as
`X-Request-ID`, including failed requests. Ignore caller-provided IDs. Associate
request-scoped GraphQL outcomes and payment-service log events with this ID.
Background events may omit a request ID but include an order ID when available.
The header is additive; GraphQL bodies and customer error wording stay unchanged.

Log HTTP completion and separately classify GraphQL outcomes: HTTP 200 is not
proof that a GraphQL operation succeeded. Expected validation, permission, conflict,
and unavailable-payment outcomes are warnings; unexpected failures are errors.
Do not count normal successes as failures. Avoid duplicate generic error entries
when replacing the existing GraphQL console error.

The additive HTTP error boundary preserves safe client status categories: malformed,
aborted, or size-mismatched JSON requests receive 400; oversized bodies receive 413;
and unsupported JSON charset or encoding receives 415. It returns the generic JSON
`{ "error": "Invalid request" }` for those client errors, and a generic unavailable
message for an unexpected 500. The boundary logs only its safe status/category and
never the request body or parser error.

Record payment provider/reconciliation failures and recovery failures at the
boundaries that currently catch them, with order ID and operation kind where known.
Preserve durable retry/backoff behavior. Record email delivery outcomes without
recipient, message contents, or links. Replace existing ad hoc runtime console
messages in the touched operational paths with structured events. CLI command
output remains unchanged. `payment.operation_processed` means the operation path
was processed; it does not claim that a provider result was durably applied, because
stale leases and later provider evidence can prevent that. A provider result of a
failed refund emits `payment.refund_failed` with the safe
`PROVIDER_REFUND_FAILED` category.

## Privacy and robustness

Use an explicit context allowlist. Never serialize requests, headers, cookies,
authorization, query strings, GraphQL documents/variables, SQL/bound values,
provider payloads, checkout URLs, email addresses, email links, passwords, tokens,
database URLs, secrets, or delivery information.

Do not log arbitrary exception messages, full error objects, or stack frames:
drivers and providers may embed secrets or customer data. Diagnostic fields are
application-owned error categories/codes. Bound any accepted string context and
validate it before output.
Use normalized route labels rather than raw URLs or dynamic auth token paths.
Logging failures must not change HTTP responses, payment outcomes, or worker retries.

## Readiness HTTP contract

- `GET /ready` needs no session and performs no writes or provider calls.
- Successful composite probe: HTTP 200, `{ "status": "ready" }`.
- Failed or timed-out composite probe: HTTP 503, `{ "status": "unavailable" }`.
- Responses include `Cache-Control: no-store` and `X-Request-ID`; disclose no
  provider, connection details, SQL, or error messages.
- Probe SQLite with `SELECT 1` on the supplied connection; probe PostgreSQL with
  `SELECT 1` through the supplied pool. Never open a new database per HTTP request.
- In Redis auth-limiter mode, also PING its dedicated connection without consuming a
  request budget. The established composite probe reports its failure as `database`;
  do not infer a distinct readiness component from that label. Safe server events
  `auth.rate_limit_unavailable` and `auth.rate_limit_recovered` identify limiter
  transitions.
- Bound readiness response time to two seconds for asynchronous probes. Limit
  concurrent probes so polling during an outage does not accumulate database work.
  Ensure late results and failures are handled; a response timeout alone does not
  cancel underlying database work. PostgreSQL readiness queries use a two-second
  client-side query timeout; the existing pool acquisition timeout is ten seconds
  and the general statement timeout is thirty seconds. Shared work remains in
  flight until the database driver settles it, so concurrent callers do not create
  more probes.
- Preserve `/health` as the existing HTTP 200 `{ "status": "ok" }` liveness response,
  even when the database is unavailable.
- Readiness measures connectivity, not full schema integrity or successful
  checkout/email delivery. Existing startup migration/schema checks remain in place.
- Suppress routine successful health/readiness polling logs. Log readiness failure
  and recovery transitions so outages are observable without a log flood.
- Neither endpoint sends alerts or restarts the process. Operators configure
  hosting checks, log collection, retention, and alert policies separately.

## Affected boundaries

- `src/app.ts`: request correlation, HTTP completion, GraphQL lifecycle logging,
  readiness route, webhook failures, safe HTTP error boundary.
- `src/shared/`: logger and request-scoped context, if needed.
- `src/database/`: provider-neutral connectivity probe and existing idle-pool errors.
- `src/graphql/errors.ts`: retain public redaction while moving operational logs
  into a correlated GraphQL boundary.
- `src/modules/payments/`: provider/recovery and worker failure logs.
- `src/modules/email/email.service.ts`: safe delivery outcome logs.
- `src/server.ts`: startup/shutdown wiring and lifecycle events.
- `test/`, `README.md`, and root `SPEC.md`: verification and delivered guidance.

## Acceptance criteria

- [x] Readiness reports 200 for working SQLite and PostgreSQL connections.
- [x] Database failure/timeout reports a generic 503 within the asynchronous deadline;
      `/health` continues to report 200.
- [x] Repeated concurrent readiness calls reuse bounded probe work; late failures
      cannot cause unhandled rejections or change a completed response.
- [x] Every HTTP response has a generated request ID; logs correlate requests and
      distinguish GraphQL errors from successful HTTP 200 responses.
- [x] Safe request, payment/recovery, email, database, and lifecycle events are
      machine-readable; routine probe successes do not flood logs.
- [x] Sensitive fixture values never appear in emitted logs or readiness responses,
      including when contained in exception messages.
- [x] Failed log output does not interrupt request handling or background work.
- [x] Existing authorization, public errors, checkout, retry, and email behavior
      remain compatible.
- [x] Focused coverage, full backend tests, lint, build, and affected PostgreSQL
      coverage pass; docs record only verified behavior.

## Verification and operation

Use isolated SQLite integration tests for HTTP/readiness/correlation and privacy.
Use controlled failures for timeout/concurrency behavior and logging sink failure.
Extend existing disposable PostgreSQL coverage to exercise the real readiness
endpoint. Add focused GraphQL HTTP-200 error, payment-recovery, and email-outcome
checks using existing fixtures; do not contact live Stripe or SMTP.

Verified evidence: `bun run test` passed 43 files with 247 tests passing and one
PostgreSQL-only test skipped; `bun run lint` and `bun run build` passed. The final
`bun run test:postgres` passed 37/37 after the readiness, HTTP-boundary, and recovery
fixes, including migrations and compiled SQLite/PostgreSQL startup and `/ready`
smoke checks. The full suite includes the malformed-JSON, concurrent-correlation,
and failed-refund-result regression coverage. Code-review fixes were reproduced with
31 passing regression tests before the final failed-refund test was added.

No frontend codegen is needed: GraphQL shapes stay unchanged.

The process implements `SIGINT` and `SIGTERM` shutdown paths that stop accepting
requests, stop recovery work, close application resources, and close the selected
database. There is no dedicated graceful-signal child-process smoke test because of
Windows child-termination behavior.

### Local inspection and hosting operation

Run `bun run dev` and inspect the one-line JSON records written to the terminal.
Each HTTP response carries a generated `X-Request-ID`; use that value to find the
request's `http.*` and GraphQL outcome records. Request `GET /ready` to check the
selected database: it returns `200 { "status": "ready" }` or
`503 { "status": "unavailable" }`, with `Cache-Control: no-store`. Routine
successful `/health` and `/ready` polling is intentionally silent.

No environment variable, log file, log database, telemetry vendor, or alerting
integration is introduced. Configure JSON log collection, retention, alerts, and a
hosting readiness check for `/ready` in the deployment environment. Keep `/health`
as the liveness check. Logs are diagnostic evidence only; payment reconciliation
and database backups remain separate operational responsibilities.

Hosted deployment, log collection/retention, alert delivery, and live-payment
behavior were not smoke-tested; they are deployment responsibilities and outside
this backend-only change.

Rollback is application-only with no migration; operators must restore a previous
health-check path if deploying a version without `/ready`.

## Delivered notification observability remediation

**Status: Implemented and locally verified; production Redis/proxy/capacity and retention operations remain release gates for in-app notifications.**

- Classify only `/api/notifications/stream` as its own safe route. Suppress generic HTTP completion/abort records for admitted HTTP 200 streams after headers were sent; setup rejections retain ordinary status/severity logging.
- Emit one warning `notifications.stream_terminated` per server write failure or sustained backpressure termination, with `component: http`, the exact stream route, correlated server request ID, and allowlisted `streamFailure: WRITE_FAILED | BACKPRESSURE`. Never log recipient identity, raw exception, frame or headers. Normal client disconnect, authorization recheck closure and shutdown are silent.
- Emit `notifications.live_unavailable` once per publisher/subscriber outage episode and `notifications.live_ready` once when that connection recovers. Both carry `component: server` and allowlisted `redisConnection: publisher | subscriber`; outage warnings retain `NOTIFICATION_LIVE_UNAVAILABLE`. Initial successful readiness is also recorded once per connection. Subscriber readiness requires successful subscription and triggers reconciliation. Publisher readiness cannot admit streams when the subscriber is unavailable. Shutdown suppresses subsequent transitions.
- Regression checks cover successful disconnect silence, setup error classification, write/backpressure warning privacy and released slots/timers, independent repeated outages, resubscription failure/recovery, and close during pending subscription.
