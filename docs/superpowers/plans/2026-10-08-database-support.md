# Database Support Implementation Plan

> **Goal:** Run the same API build on SQLite development and PostgreSQL production, selected through configuration.

**Spec:** [Database support](../../../specs/database-support/SPEC.md).
**Architecture:** Compose async repositories over provider adapters, preserving atomic business operations and GraphQL behavior. Keep driver/schema/migration/locking differences inside adapters.
**Constraints:** Node 24+, Bun 1.3.14, Drizzle, no delivery implementation or data reset, no source edits when switching providers.

## Tasks

1. **Provider runtime and schemas** — own configuration, PostgreSQL connection/schema/migration infrastructure, dependencies and local PostgreSQL test provisioning. Add failing provider-configuration tests, verify failure, implement environment selection/TLS/lifecycle. Generate PostgreSQL baseline and test fresh migration and schema readiness.
2. **Async persistence and shared application** — own module repositories/services/resolvers, GraphQL composition, auth and app wiring. Add async/provider contract tests first. Refactor driver dependencies into adapters with shared business rules and portable Drizzle queries; adapt authorization, stock/status/payment operations and durable leases. Await all repository calls.
3. **Entry points and parity validation** — wire server/seeds/CLI to provider runtime; verify auth/API/provider contracts, simultaneous stock/checkout/lease races, error rollback and clean shutdown. Preserve existing SQLite fixtures and frontend API contract. Add required PostgreSQL integration command and adapt browser test backend setup to run both providers.
4. **Review and documentation** — run tests/lint/build and browser flows, review changes independently, reconcile documentation with spec-updater, mark only verified criteria delivered. Keep unresolved criteria explicit.

## Integration contract

- Database adapter handle is private to database/provider composition and persistence adapters, never business services.
- SQLite and PostgreSQL runtime expose the same async repository interfaces and auth persistence configuration.
- Repository transaction scope pins a single connection/client; no external provider work within transactions.
- `openDatabase(config)` is async and `close()` is awaitable. SQLite legacy `createDatabase(path)` remains available only to SQLite migration/tests until converted entry points no longer require it.
- Config exposes provider, SQLite path or PostgreSQL URL, pool/TLS/CA options. PostgreSQL migration is explicit; runtime startup verifies readiness.

## Review focus

- Concurrent checkout idempotency must not double-reserve stock.
- PostgreSQL transactions must not accidentally use pool queries outside their checked-out client.
- SQLite synchronous calls converted to async must never create unawaited permission or state reads.
- Stale worker lease completion cannot overwrite current lease owner.
- Search escaping, date/boolean values and generated schema constraints must preserve API behavior.

## Verification record

- [x] Provider configuration and connection tests
- [x] SQLite suite, lint and build — 163 tests across 31 files
- [x] PostgreSQL fresh migration and API/service suite — 10 shared contract tests against PostgreSQL 17.10; migration/seed/demo/operator commands and both providers on the same compiled API verified
- [x] PostgreSQL independent-client concurrency checks — stock, request keys, status transitions and leases
- [x] SQLite and PostgreSQL browser journeys — 33 tests on each provider, plus six PostgreSQL journeys repeated after review safeguards
- [x] Final review and specification reconciliation — independent audit findings resolved; final spec-updater reconciliation reviewed

Implementation is authorized by the user's request; use scoped workers for independent persistence/infrastructure tasks, then integration and review.

Frontend verification: 105 tests across 26 files, lint and production build pass.
Review fixes have regression coverage: unexpected GraphQL database errors are masked;
sample catalog seeding rejects production before connecting. Disposable PostgreSQL
tests require their wrapper-generated UUID and loopback database target.
