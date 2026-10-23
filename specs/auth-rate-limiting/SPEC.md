# Shared authentication rate limits

**Status:** Implemented

**Date:** 2026-10-21

## Scope and contract

Implement S5 from [review remediation](../review-remediation/SPEC.md). Use existing ioredis and Redis infrastructure, with a dedicated API connection and key namespace independent of email/in-app-notification flags. No session-storage, GraphQL, database, frontend or payment changes.

- `AUTH_RATE_LIMIT_STORE` accepts `memory` or `redis`; development/test default to memory and production defaults to redis. Reject memory mode in production. The worker does not load this API-only configuration.
- Redis mode requires `REDIS_URL` and explicit `AUTH_RATE_LIMIT_PREFIX` (1-100 ASCII letters, digits, hyphens or underscores). Production requires authenticated `rediss:` with normal certificate validation; reject URL query/fragment overrides. Memory mode needs neither Redis nor a prefix.
- Preserve Better Auth route rules, trusted client-IP derivation and response format: verification resend 1/60 seconds, password-reset requests 3/300 seconds, existing stricter sign-in/signup defaults. Count requests before their outcome; denied requests do not extend expiry.
- Atomically check/increment a fixed-window counter and set expiry using one Redis Lua execution. Return remaining TTL rounded up to seconds for 429. Never perform a separate read/write or queue/replay commands after disconnection. Use Redis TTL rather than API clocks.
- Keys use `<prefix>:auth-rate-limit:<HMAC-SHA256>` of the Better Auth key and window, keyed by the existing shared auth secret. Never store raw IPs, emails or request paths in limiter keys, nor log keys, credentials or raw Redis errors. All API instances must share secret, prefix, Redis database and rules.
- Redis errors, command timeouts and invalid replies fail closed: auth requests get HTTP 503 with `{ "code": "AUTH_RATE_LIMIT_UNAVAILABLE", "message": "Authentication is temporarily unavailable. Please try again shortly." }` and `Retry-After: 5`. Never fall back to memory or turn provider outages into 429. Exempt health/liveness and non-auth application paths from this response.
- Use bounded connection/command timeouts (1000 ms), no offline queue, no automatic command resend and bounded reconnect backoff. Do not wait indefinitely on startup. `/ready` includes a Redis PING in Redis mode and returns existing 503/unavailable while Redis is unavailable; `/health` remains live. A healthy PING cannot guarantee Lua ACL availability: consume failures still fail closed.
- Close the dedicated connection on normal shutdown and all application initialization failures after allocation. Deduplicate safe unavailable/recovered transition logs. Readiness must not consume request budgets.

## Verified acceptance criteria

- [x] Concurrent requests across two real API processes share one budget; only the allowed number reaches the auth handler.
- [x] Restarting an API process with the same configuration preserves the remaining Redis budget.
- [x] Expired windows permit requests again, denied requests retain a positive retry interval and do not refresh the window.
- [x] Different prefixes, client keys and route windows remain independent; stored keys contain no raw identities.
- [x] Redis loss returns neutral bounded 503 responses for known/unknown accounts, readiness fails, liveness stays healthy and recovery restores service.
- [x] Invalid production configuration is rejected without exposing secrets; local memory mode preserves existing behavior.
- [x] Startup failures and shutdown close clients; focused auth, proxy, and lifecycle regressions pass.

## Validation and operations

Use a disposable loopback Redis supplied explicitly via `AUTH_RATE_LIMIT_TEST_REDIS_BINARY` (spawn without persistence in a temporary directory) for real Redis tests. Do not reuse development/production Redis or flush databases. Ordinary tests may skip that optional suite when the binary is absent; verification records must distinguish skipped from executed evidence.

Run focused regressions first, then backend tests/lint/build and PostgreSQL parity for integration confidence. No schema migration is required.

Production rollout adds a required API Redis dependency even when notification/email delivery is disabled. Provision credentials/ACL permissions for PING and EVAL plus GET/SET/INCR/PTTL used by the script, verified TLS and an explicit per-deployment prefix before deploying. Redis must retain counters across API restarts; Redis restart/flush/eviction or changing the secret/prefix resets budgets. Choose appropriate Redis persistence, capacity and no-eviction operations for the required protection. Rollback to the old application restores process-local limits and therefore requires a single API instance or equivalent shared edge protection.

## Verification evidence

The initial focused outage regression failed as expected with a 200 response before the shared limiter was introduced. After implementation, six focused rate-limit tests passed: configuration validation; fixed-window TTL, namespace and HMAC-key privacy; two-process sharing of the reset budget across 12 concurrent requests; restart persistence; Redis loss/recovery; bounded timeout against an unresponsive Redis; neutral known/unknown-account 503 responses; and startup-failure cleanup. The final focused run also proves that a successful readiness-only PING emits `auth.rate_limit_recovered` and clears suppression for a later `auth.rate_limit_unavailable` event. The optional real-Redis suite uses `AUTH_RATE_LIMIT_TEST_REDIS_BINARY` to spawn an explicit disposable loopback Redis without persistence in a temporary directory; it never uses production Redis.

The full backend suite passed with 340 tests and 4 skips (two pre-existing and two optional Redis tests), and lint and build passed. SQLite integration coverage is included in those results. PostgreSQL parity passed 43 contract tests plus compiled SQLite and PostgreSQL application smoke checks.
