# 🧭 Auth email verification and recovery — API

> **Goal:** Require verified email for account access and provide password recovery through Better Auth and the shared email delivery path.

**Status:** Implemented

**Date:** 2026-10-12

---

## 🎯 Objective

Sign-up requires verification before access, and self-service recovery is available without changing orders, role assignments, payment behavior, or persistence schemas. The delivered admin directory adds a read-only verification-status field; the matching [frontend spec](../../../frontend/specs/auth-email/SPEC.md) owns customer-facing routes.

---

## 📦 Scope

**In scope**

- Verification links, resend, password-reset links, and verified-session enforcement.
- One backend SMTP sender using Nodemailer, with separate verification/reset email content.
- Ethereal development delivery, configurable Brevo production delivery, and injected captured-mail test delivery.
- Existing-account rollout, demo seeding compatibility, SQLite/PostgreSQL parity, and documentation.

**Out of scope**

- Social sign-in, OTP codes, MFA, email-address changes, or a public notification-management framework. Redis queues and order notifications are now defined by [production email notifications](../email-notifications/SPEC.md).
- Live payments, order ownership changes, new GraphQL operations, or replacing existing authorization checks.
- Automatically marking existing real accounts verified, deleting customer data, or copying credentials from another project.

---

## ⚙️ Assumptions & Constraints

**Technical**

- Reuse the installed Better Auth version and Drizzle adapters. [auth.ts](../../src/auth.ts) sets `autoSignIn: false` and `requireEmailVerification: true`.
- Both [SQLite auth schema](../../src/database/auth-schema.ts) and [PostgreSQL auth schema](../../src/database/postgresql/auth-schema.ts) already contain `emailVerified` and verification storage. No schema migration was needed.
- Better Auth owns signed verification links, validation, and reset-token storage/consumption. Do not build custom tokens. Verification links are not assumed to be database-backed or single-use like password-reset tokens.
- Explicitly configure verification and reset expiry to **3600 seconds**. Set `autoSignIn: false`, `requireEmailVerification: true`, `sendOnSignUp: true`, `sendOnSignIn: false`, and `autoSignInAfterVerification: false`. Users sign in after verification.
- Set `revokeSessionsOnPasswordReset: true`; completing recovery requires a fresh sign-in, without erasing the cart or changing ownership.
- Browsing, cart, `/health`, Stripe webhooks, and payment reconciliation remain independent of verified browser sessions.

**Product / Business**

- Sender name defaults to **The Quiet Shelf**; the SMTP sender address must be supplied and authorized for the chosen provider.
- Existing unverified users verify before new sign-in; there is no role-based verification exemption for real Staff/Admin accounts.
- Production email delivery depends on operator-supplied SMTP credentials and sender/domain setup. Ethereal captures test mail and is development-only.

**Dependencies**

- Add Nodemailer, BullMQ, and Redis client dependencies in the backend only. No frontend SMTP or Redis secrets are needed.
- Development/test implementation must work with an injected captured-mail sender before real credentials are available.

---

## 🧩 Delivered behavior

- **Sender boundary:** `src/modules/email/email.service.ts` owns a reusable transporter, bounded connection/send timeouts, shutdown cleanup, and delivery. `email.content.ts` separates email content from transport. Its narrow contract is `send({ to, subject, text, html }): Promise<void>`; auth callbacks consume it and tests inject a collector.
- **Message presentation:** verification and reset HTML use the shared email-compatible
  The Quiet Shelf layout (inline styles, presentation tables, 600px maximum width,
  storefront cream/forest colors, serif headings, hidden preheader, button, and
  service footer). They keep the exact callback URL supplied by Better Auth, the
  one-hour expiry/security language, existing subject, and plain-text alternative;
  the HTML also exposes a copyable fallback URL.
- **Configuration:** [env.ts](../../src/config/env.ts), [app.ts](../../src/app.ts), and [server.ts](../../src/server.ts) support `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`, and optional `SMTP_REPLY_TO`. They require paired credentials and a valid host/port/from; 587 uses STARTTLS and 465 uses implicit TLS. The production email worker fails with incomplete SMTP configuration and rejects Ethereal; a queued API does not need SMTP/Redis connectivity. Tests use injection.
- **Local setup:** document Ethereal's `smtp.ethereal.email:587` and the test-inbox workflow. Do not create an Ethereal account automatically, log verification URLs/tokens, or copy the Strapi project's credentials. SMTP acceptance is not proof of inbox delivery.
- **Better Auth callbacks:** configure `sendVerificationEmail` and `sendResetPassword` in [auth.ts](../../src/auth.ts). In queued mode they await durable outbox recording only; the worker later sends the supplied URL. This is not atomic with Better Auth's token/user write: a crash before the callback records the row requires the normal resend/reset recovery path. Generic reset/resend responses and the 500 ms reset floor remain unchanged for known and unknown accounts.
- **Public HTTP contract:** reuse Better Auth under `/api/auth`: POST `/sign-up/email`, `/sign-in/email`, `/send-verification-email`, `/request-password-reset`, `/reset-password`; GET `/verify-email` and `/reset-password/:token`. Frontend uses Better Auth client methods. No custom GraphQL mail mutations or duplicate auth endpoints.
- **Privacy and rate limits:** signup for an existing email and reset/resend responses remain neutral for unknown/known identities. Use existing server limiter infrastructure, with explicit rules: verification resend at most **1 request per 60 seconds per client IP**, reset requests at most **3 per 300 seconds per client IP**; preserve stricter existing defaults for other routes. UI cooldown is supplementary. Existing in-memory limits are process-local and reset on restart; shared limits are a later deployment concern. Do not claim an email-specific distributed cooldown.
- **Callback destinations:** restrict mail callbacks to fixed frontend result routes and the configured trusted origin. Sanitize any carried `returnTo` separately; never accept an arbitrary redirect destination from the caller. Reset callback handles token/error query parameters without logging them.
- **Verified access:** [app.ts](../../src/app.ts) does not expose an unverified user as authenticated in GraphQL context, including pre-feature sessions. It reads current session state with cookie caching disabled and reuses `UNAUTHENTICATED` permission boundaries; no order write/stock change can occur. Better Auth account operations also require a verified session. Keep private account/workspace access denied until fresh verified sign-in.
- **Verification session rule:** after the first successful verification, Better Auth deletes that account's existing sessions. Replaying an already-used verification link does not revoke a session created by the later verified sign-in.
- **Existing-account rollout:** retain all user IDs, passwords, orders, and roles. Run `bun run auth:revoke-unverified preview` then `bun run auth:revoke-unverified apply` against the selected database before enabling the frontend flow. The command reports counts only and deletes unverified users' sessions only; it preserves users, orders, and roles and never marks accounts verified. Direct API protection remains enforced if an old session remains. Staff/Admin use the same resend flow.
- **Demo accounts:** adjust [demo-seed.ts](../../src/database/demo-seed.ts) only for the exact reserved local/test demo identities. Verify existing reserved account credentials before changing them; explicitly mark these fixtures verified and retain role/idempotency safeguards. Seeding remains prohibited in production. Ordinary signup and Staff/Admin accounts never bypass verification. Adapt API/browser fixtures to verify synthetic users through the captured inbox or explicitly trusted fixture setup.
- Coordinate with the [implemented auth contract](../authentication/SPEC.md) and [delivery contract](../delivery/SPEC.md). Any internal context/seed changes must retain GraphQL schema and stored-order contracts.

These files and environment keys are delivered boundaries.

---

## 🚀 Delivered implementation

1. **SMTP boundary and fixtures** — _(role: backend)_ — add validated configuration, reusable sender, safe mail content, and captured-mail injection with focused failure/redaction coverage.
2. **Verification contract** — _(role: backend)_ — write failing integration tests, configure Better Auth, enforce verified sessions, constrain redirects/resends, and adapt demo/rollout handling.
3. **Password recovery** — _(role: backend)_ — prove neutral requests, expiry, invalid/reused reset tokens, password replacement, and session revocation before completing callbacks.
4. **Connected verification** — _(role: fullstack)_ — coordinate frontend routes and isolated E2E, run both provider checks, and reconcile documentation after acceptance passes.

---

## ✅ Acceptance Criteria

**Functional**

- [x] New signup sends captured verification mail, creates no usable session, and cannot sign in until verified.
- [x] Valid verification updates the correct account; expired/invalid/repeated links have safe outcomes without minting another session or changing unrelated users.
- [x] Resend allows existing unverified accounts to recover, enforces server limits, and does not enumerate users.
- [x] Old unverified sessions cannot access protected GraphQL data or create checkout; existing verified role/ownership rules remain intact.
- [x] Reset requests are neutral; valid tokens change the password once; expired/invalid/reused tokens fail; old sessions are revoked.
- [x] Existing account IDs/orders/roles survive rollout, and local demo seeding remains safe and idempotent.
- [x] Mailer supports configurable development/production SMTP; captured test mail requires no live credentials.

**Non-functional** (performance, security, accessibility, reliability)

- [x] Callbacks are trusted and credentials/tokens/mail bodies are absent from logs and public errors.
- [x] Send failures are observed without unhandled rejections, unsafe user disclosure, or coupling unrelated order transactions to SMTP.
- [x] SQLite/PostgreSQL application outcomes match; no Redis or unnecessary schema/GraphQL changes are introduced.
- [x] Required checks pass and documentation records delivered configuration, rollout, and known non-durable delivery limitations.

---

## 🧪 Validation Plan

**Manual tests**

- With separately supplied Ethereal credentials, inspect verification/reset messages and follow links against local callback URLs. Confirm failure/resend behavior and no cart loss. Real Brevo delivery is a separate credential-dependent check, not a prerequisite for isolated automated tests.

**Automated tests**

- Use integration-first **failing test → implementation → green refactor** for each behavior criterion. Extend existing auth/API/seed/config tests; use focused sender tests for SMTP options, shutdown, escaping, and rejected sends.
- Capture mail in isolated tests; inspect emitted links to test expiry, invalid/replayed reset tokens, neutral unknown-account responses, redirect rejection, rate limits, pre-feature sessions, and no protected writes.
- Run `bun run test`, `bun run lint`, `bun run build`, and `bun run test:postgres`; extend parity coverage for auth email/recovery. Coordinate full frontend `bun run test:e2e` and PostgreSQL browser checks for the changed auth journey.
- No test may send real messages, connect to production SMTP, or expose captured links publicly. Test-only inbox retrieval is never mounted in production.

**Rollback / mitigation**

- Coordinate frontend/backend deployment and reversal. Disabling new verification enforcement is an explicit operator decision; it must not reset data or silently mark accounts verified. Revoked sessions stay revoked and users may need to sign in again. Keep the mail sender backward-compatible during rollout.

## Verification evidence

On 2026-10-12, 216 backend tests across 39 files, lint, build, and code generation passed. The 27-test PostgreSQL parity run covered verification, recovery/reset reuse, session revocation, the preview/apply session-rollout command, and the read-only admin verification projection. The feature adds `emailVerified: Boolean!` to the admin GraphQL types without a schema migration or mail mutation. Captured mail exercised delivery behavior without live SMTP credentials.

---

## ⚠️ Operational limits and follow-up

**Risks**

- **Risk:** Existing unverified users lose access — _Mitigation:_ document rollout and recovery, retain identities/roles, verify demo fixtures explicitly, and test old sessions.
- **Risk:** Mail credentials or token links leak — _Mitigation:_ server-only env, restricted logging, fixed callbacks, and redaction tests.
- **Risk:** SMTP outage or process crash loses mail — _Mitigation:_ bounded sends, observed failures, explicit resend, and documented non-durable delivery; defer a queue until justified.
- **Risk:** Framework token/session semantics differ from assumptions — _Mitigation:_ inspect the installed version and prove behavior through integration tests on both providers before adding custom logic.

**Remaining follow-up**

- Captured-mail implementation is complete. Live inbox delivery requires SMTP credentials, an authorized sender/domain, and final HTTPS frontend/auth origins supplied by the deployer; Ethereal/Brevo delivery was not tested in this change.

## Admin verification visibility

**Status:** Implemented

- `emailVerified: Boolean!` is a read-only field on the Admin-only `AdminUser` and compatibility `AdminCustomer` GraphQL types. List and detail queries project the existing Better Auth flag on SQLite and PostgreSQL; no migration, verification mutation, control, filter, or bypass is added.
- Current authorization, pagination, role changes, password-reset behavior, and private-field boundaries are preserved.
- [x] API list/detail return both verification states correctly and retain private-field/authorization boundaries.
- [x] SQLite/PostgreSQL parity, generated resolver types, tests, lint, and build pass.
