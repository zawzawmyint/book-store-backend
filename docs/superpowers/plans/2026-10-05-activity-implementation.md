# Activity History Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement the backend and frontend tasks, followed by coordinated review and validation.

**Goal:** Deliver the approved backend/frontend activity specifications.

**Architecture:** Persist activity entries in the same SQLite transaction as each supported change. Expose one Admin-only GraphQL query and reuse its typed operation across global activity and book history.

**Tech Stack:** Existing Express/Apollo/Drizzle/SQLite and React/Apollo/shadcn stack; no new runtime dependencies.

**Spec:** [Backend](../../../specs/activity/SPEC.md), [frontend](../../../../frontend/specs/activity/SPEC.md).

## Constraints

- Preserve current uncommitted Users/Staff changes; work in the existing paired checkouts because isolated worktrees would omit those required changes.
- Actor/source comes from the server or explicit operator context. No silent unaudited write path.
- No activity write API, customer activity, secrets, backfill, or automatic deletion.
- The specifications become Implemented only after acceptance criteria and checks are verified. No commits, deployment, or production data changes are part of this request.

## Tasks

- [x] Backend: added focused API/transaction tests; implemented activity schema/query/validation/writer, atomic catalog/account/CLI integration; generated migration/resolvers; ran 76 tests, lint, and build.
- [x] Frontend: added focused component tests; implemented typed operation, guarded routes/navigation, shared activity display/filtering and book history; ran codegen, 58 tests, lint, and build.
- [x] Integration: added isolated browser journeys for permissions, Staff changes, history/filtering, mobile behavior, and session privacy; the full 22-journey browser suite passed.
- [x] Review: reviewed spec compliance and correctness, resolved no material review findings, reverified checks, and reconciled documentation.

## Review focus

- Event failure must roll back business data and password session changes.
- Aliases/CLI must log exactly once; no-op changes must not log.
- Historical names/roles and actor deletion must preserve records without leaking secrets.
- Invalid dates/IDs and inaccessible direct URLs must not issue unauthorized history queries.
- Demotion and session changes must remove private history, including after failed role refresh.
