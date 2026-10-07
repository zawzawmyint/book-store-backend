# The Quiet Shelf API — activity history specification

> **Status:** Implemented. **Date:** 2026-10-05. Migration `0005_panoramic_invisible_woman` is generated in this change but has not been applied to a development or production database.

## Goal and agreed scope

Record who changed store data, what changed, and when, and expose that history only to Admin.

Provide accountability for Staff/Admin catalog changes and Admin/operator account actions. Follow the existing [role model](../staff/SPEC.md) and coordinate with the [frontend specification](../../../frontend/specs/activity/SPEC.md). History begins after the updated backend runs with migration `0005_panoramic_invisible_woman` applied; earlier changes cannot be reconstructed reliably.

## Scope and exclusions

**In scope**

- Book creation, metadata/price edits, manual stock adjustments, archive and restore.
- Role changes through `setUserRole`, both retained Boolean compatibility mutations, and `admin:access` grant/revoke.
- Successful Admin password resets through canonical and compatibility mutations.
- Order-status transitions and cancellation stock restoration, plus an Admin-only paginated activity query used for global activity and individual book history.

**Out of scope**

- Customer shopping, checkout stock reservations, browsing, searches, login events, failed attempts, own-profile/password changes, and seed/migration backfills. Safe payment-state changes are recorded separately as system-attributed order payment activity by [the Stripe checkout feature](../stripe-checkout/SPEC.md).
- Staff access to history, activity exports, undo, notifications, automatic retention cleanup, tamper-proof infrastructure, and logging arbitrary external SQL writes.

## Current system and design constraints

- Reuse Express/Apollo, SQLite, Drizzle, module-local validation, and current server-side permissions. No queue, external logging service, or additional auth system.
- Changes and their events commit in the **same SQLite transaction**. Event insertion failure rolls back the business change. No fire-and-forget logging.
- Resolve the actor from the authenticated request and current stored role. Capture that role before self-demotion. CLI events use an explicit operator identity/source.
- Preserve existing mutation return shapes, validation, password-reset session revocation, stock limits, and authorization ordering.

- Admin alone reads history; Staff actions are recorded but Staff cannot read logs.
- Activity is append-only through the application: no create/edit/delete activity mutation. Direct database access is outside this guarantee.
- Retain entries without automatic deletion in this delivery. Actor/target deletion must not erase their history.

- The implemented [Staff](../staff/SPEC.md) and [Users](../users/SPEC.md) contracts remain unchanged. Frontend code generation is coordinated with this GraphQL contract.

## Storage and migration

`activity_events` in [schema.ts](../../src/database/schema.ts) has an integer primary-key `id`; nullable `actor_user_id` referencing `user.id` with ON DELETE SET NULL; immutable `actor_name` and nullable `actor_role` snapshots; `source` (`GRAPHQL` or `OPERATOR`); `action`; `target_type` (`BOOK`, `USER`, or `ORDER`); opaque text `target_id`; `target_name` snapshot; validated `changes_json`; nullable integer `stock_delta`; and server-generated UTC `created_at`.

- User actors require a role snapshot; operator actors have null user ID/role and the name **Operator command**. Never infer a named human operator from a CLI invocation.
- Target IDs deliberately have no cascading foreign key. Snapshot names preserve context if a book is renamed or an account disappears.
- Each change has `{ field, before, after }`. Values are strings or null: text unchanged, integer cents/stock as base-10 strings, Boolean state as `true`/`false`, and roles as enum names. Null means no previous value for creation; missing changes are omitted.
- Allowlist fields: TITLE, AUTHOR, GENRE, DESCRIPTION, PRICE_CENTS, STOCK, ARCHIVED, ROLE, ORDER_STATUS. Never serialize complete request, account, credential, or session objects. No passwords, hashes, tokens, cookies, IP addresses, email snapshots, or cancellation text.
- Generated Drizzle migration `0005_panoramic_invisible_woman` and its metadata add indexes for newest-first listing, `(target_type, target_id, id)`, and actor lookup. Existing business data remains unchanged; the new log starts empty when the updated backend migrates a database.

## Events and atomic write behavior

- `BOOK_CREATED`: initial book fields, price, stock, and archive state; every before value is null.
- `BOOK_UPDATED`: one event containing only changed metadata fields, including price. A price-only update is still BOOK_UPDATED with PRICE_CENTS; a combined edit does not generate duplicate price events.
- `BOOK_STOCK_ADJUSTED`: stock before/after and signed delta, using values read and written inside the stock transaction.
- `BOOK_ARCHIVED` / `BOOK_RESTORED`: archive-state transition only.
- `USER_ROLE_CHANGED`: role before/after, including CLI recovery and Boolean compatibility mappings.
- `USER_PASSWORD_RESET`: action/actor/target only, with an empty changes list. Hash before entering the transaction, then update credentials, revoke sessions, and insert the event together.
- `ORDER_STATUS_CHANGED`: status before/after with an ORDER target named `Order request #<id>`; customer contact and cancellation-reason text are excluded. A cancellation also writes the existing `BOOK_STOCK_ADJUSTED` event for each restored book in the same transaction.
- Unchanged normalized metadata, unchanged role/archive state, denied/invalid requests, and rolled-back writes produce no event. Creation produces one event; a successful reset produces one event even though password equality is never inspected.

`src/modules/activity/` supplies event shapes, query schema/resolver/service/validation/repository, and a shared insertion function that receives the active transaction. [Book repositories/services](../../src/modules/books/admin-book.repository.ts), [admin repository/resolvers](../../src/modules/admin/admin.repository.ts), and [operator CLI](../../src/modules/admin/admin-access-cli.ts) pass server-owned actor context. Old values are read inside the transaction, normalized values are compared, and the write and event commit together. Compatibility fields delegate to the same audited write path exactly once; CLI call sites supply operator context explicitly.

## GraphQL contract and authorization

- `adminActivity(actorUserId: ID, action: ActivityAction, changedField: ActivityField, targetType: ActivityTargetType, targetId: ID, from: String, to: String, limit: Int, offset: Int): ActivityPage!`.
- `ActivityPage { total: Int!, items: [ActivityEvent!]! }`.
- `ActivityEvent { id: ID!, actorUserId: ID, actorName: String!, actorRole: UserRole, source: ActivitySource!, action: ActivityAction!, targetType: ActivityTargetType!, targetId: ID!, targetName: String!, changes: [ActivityChange!]!, stockDelta: Int, createdAt: String! }`.
- `ActivityChange { field: ActivityField!, before: String, after: String }`. Enums use the values defined above.
- [Authorization](../../src/modules/admin/admin.authorization.ts) includes `VIEW_ACTIVITY`, granted only to ADMIN. Authentication/authorization occurs before filter validation or lookup. Guests receive UNAUTHENTICATED; Staff/Customer receive FORBIDDEN, including aliases and mixed operations.
- Default limit 20, maximum 50, nonnegative integer offset. Filters combine with AND; order by `id DESC`. Total and items use the same filters. IDs must be nonblank; targetId requires targetType. Unknown authorized targets return an empty page, not leaked identity details.
- Date bounds must be valid RFC3339 UTC instants (`Z` or `+00:00`) and satisfy from < to; use **from inclusive, to exclusive**. Events have millisecond timestamps. For a supplied fractional instant finer than milliseconds, the API rounds the query bound up to the next millisecond so SQLite's millisecond comparison preserves the requested boundary. Invalid filters return BAD_USER_INPUT. PRICE_CENTS filtering finds edits containing a price change without introducing a separate price event.
- The module is composed in [the GraphQL schema](../../src/graphql/schema.ts) and resolvers; resolver types were regenerated through codegen.

## Acceptance criteria

- [x] Each successful in-scope change creates exactly one matching event; combined metadata/price edits remain one event.
- [x] Staff and Admin attribution, self-demotion actor role, and explicit operator-source recovery are correct.
- [x] No-ops, rejected writes, and checkout stock reductions create no activity events; real order-status changes create one ORDER_STATUS_CHANGED event and cancellation restoration records stock events atomically.
- [x] Admin can paginate/filter global and book history; every non-Admin request is denied before validation/lookup.
- [x] Historical actor/target names remain readable after rename/deletion; existing records remain unmodified by migration.

- [x] Failed log insertion rolls back each business write, including password update/session deletion and stock adjustment.
- [x] No credential/session secrets or forbidden snapshot fields enter the stored log or API.
- [x] Query ordering/filtering is deterministic and bounded; backend codegen, tests, lint, and build pass.

## Validation and release

**Browser and visual checks**

- The isolated browser journey promotes Staff, performs a combined metadata/price edit and stock adjustment, then verifies global filtering, book history, escaped details, mobile navigation, and an active-session demotion.
- Existing seeded books show the deployment-start empty state because seed creation is intentionally excluded from logging.

**Automated tests**

- API permission/filter/pagination tests cover field allowlists, exact-once aliases, no-ops, actor snapshots, deletion preservation, operator recovery, and finer-than-millisecond bounds.
- Event-insertion failure tests cover create, metadata, stock, archive/restore, roles, and password credential/session changes. Concurrent stock and price requests assert transaction-captured before/after values.
- Backend codegen, 76 tests, lint, build, and the coordinated 22-journey Chromium suite passed. The generated migration is covered by the existing migration tests; no runtime development or production database was migrated for this change.

**Rollback / mitigation**

- Back up persisted SQLite data before migration. The migration is additive; a prior compatible application may ignore the new table, but running it stops logging. Preserve the activity table and document any gap; do not delete history as part of application rollback.

## Risks and open decisions

**Risks**

- **Risk:** Logging failure prevents an otherwise valid write — _Mitigation:_ deliberate atomic policy, actionable errors, rollback tests, and sufficient database storage.
- **Risk:** Descriptions and long-lived actor snapshots grow storage — _Mitigation:_ retain existing field limits, bounded reads, and indexed filters; retention/export policy requires a separate change.
- **Risk:** Direct database edits evade attribution — _Mitigation:_ route supported administrative recovery through the audited CLI; do not describe this as tamper-proof auditing.

**Open decisions**

- None. Admin-only visibility and no automatic retention cleanup are explicit delivered scope limits.
