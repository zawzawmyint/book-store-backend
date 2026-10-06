# The Quiet Shelf API — staff roles specification

> **Status:** Implemented. **Date:** 2026-10-05.

## Goal and agreed scope

Add a limited STAFF role so employees can maintain the catalog and inspect order requests. Administrators retain full store access and exclusive authority over user management and book archive/restore. Coordinate with [the frontend spec](../../../frontend/specs/staff/SPEC.md). Extend the implemented [user directory contract](../users/SPEC.md).

The following activity exclusion was the historical scope of this Staff delivery and is superseded by [the activity history specification](../activity/SPEC.md): Staff changes are now recorded, while reading history remains Admin-only. Invitations, staff creation forms, configurable roles, multiple roles per user, owner/super-admin roles, approval workflows, and order processing/status changes are still excluded.

## Role and permission rules

- CUSTOMER retains shopping, own orders, and own profile/password access.
- STAFF retains those shopping capabilities and gains catalog reading, book creation, metadata/price editing, stock adjustments, and reading all saved order requests.
- ADMIN retains existing capabilities, including shopping, plus user directory/detail access, role assignment, another user's password reset, and archive/restore.
- Staff may read and edit archived books and adjust their stock under the existing rules, but cannot archive or restore them. A new book is active under the existing creation defaults.
- Staff cannot read the user directory or arbitrary user details, reset another user's password, or change anyone's role. Order contact snapshots remain visible through order queries; this does not grant access to the user directory.

Use a small server-owned permission map in the existing admin module, with permissions `MANAGE_CATALOG`, `VIEW_ORDERS`, `ARCHIVE_BOOKS`, and `MANAGE_USERS`. STAFF receives the first two; ADMIN receives all four; CUSTOMER receives none. No permission administration UI or permission tables are required.

Enforce these checks on the existing API:

- `adminBooks`, `adminBook`, `createBook`, `updateBook`, `adjustBookStock`: MANAGE_CATALOG.
- `adminOrders`, `adminOrder`: VIEW_ORDERS.
- `setBookArchived`: ARCHIVE_BOOKS.
- `adminUsers`, `adminUser`, `setUserRole`, `resetUserPassword`, and all retained user-management compatibility fields: MANAGE_USERS.
- `viewer` remains available for any signed-in user; its role comes from current storage.

Checks precede argument validation and record lookup. Guests receive UNAUTHENTICATED and authenticated users without the required permission receive FORBIDDEN, including aliases and mixed operations. Every protected resolver reads the current role; sessions and caller input cannot establish permissions. Demotion takes effect on the next request; an already authorized operation may finish. A STAFF denial on an admin-only action does not change the stored role.

## GraphQL contracts

```graphql
enum UserRole { CUSTOMER STAFF ADMIN }
enum AdminUserRoleFilter { ALL CUSTOMER STAFF ADMIN }

extend type Mutation {
  setUserRole(userId: ID!, role: UserRole!): AdminUser!
}
```

Extend the existing enums rather than defining duplicates. `Viewer.role`, `AdminUser.role`, and the legacy `AdminCustomer.role` use UserRole and may return STAFF. Extend the compatibility `AdminCustomerRoleFilter` with STAFF too. Existing list defaults, fields, pagination, search, ordering, and privacy rules remain unchanged. ALL includes all three roles; each specific filter matches the resolved role exactly. Users without an elevated role must not be mislabeled as staff or admin.

`setUserRole` requires an existing nonblank opaque user ID and a valid enum. It is idempotent, atomically assigns one role, returns the resulting user, and changes no identity, credentials, sessions, or orders. Unknown/blank IDs return BAD_USER_INPUT with no write; invalid enum values fail GraphQL validation. No public signup/profile field may assign roles. Administrators may change their own role or demote the final admin, preserving existing policy and operator recovery. Losing ADMIN immediately denies subsequent user-management requests, even if the new role is STAFF.

## Storage and migration

Add server-owned `user_roles` in `src/database/schema.ts`:

- `user_id`: primary key, foreign key to Better Auth `user.id`, ON DELETE CASCADE.
- `role`: non-null text with a database CHECK allowing CUSTOMER, STAFF, ADMIN.
- One row at most per user. Absence resolves to CUSTOMER. Signup continues to create ordinary users without granting a privileged role. Role assignment upserts the selected role, including CUSTOMER.

The table is the sole role authority. Generate and commit a Drizzle migration that copies every existing `admin_memberships.user_id` as ADMIN and removes the old membership table. Preserve all user IDs, authentication records, orders, and existing admins. Do not alter generated Better Auth tables. Use the existing migration wrapper for fresh, current, and supported legacy databases; verify migration composition across those states. That Staff migration does not add an activity table; the separate Activity delivery adds it in `0005_panoramic_invisible_woman`.

Update `admin.repository.ts` with shared `getUserRole`/`setUserRole` behavior, role-aware joins/filters, and password-reset handling. Keep a compatibility `setAdminAccess(userId, enabled)` wrapper for existing callers. Do not maintain two role authorities or infer roles from email.

## Compatibility and operator process

Retain `setUserAdminAccess` and legacy `setCustomerAdminAccess`: true assigns ADMIN, false assigns CUSTOMER, including when the target is STAFF. Both require MANAGE_USERS and delegate to the same role setter. Deprecate both in favor of `setUserRole`; no field is removed in this delivery. Legacy query/detail/password fields retain their types and admin-only access.

Preserve `bun run admin:access -- grant|revoke <user-id>`: grant assigns ADMIN; revoke assigns CUSTOMER. The command uses the configured database and migration wrapper, requires an existing exact user ID, is idempotent, and creates no user/password. It remains the first-admin and recovery path. No staff-specific CLI is required.

Operational flow: a person signs up as CUSTOMER, an ADMIN assigns STAFF through Users, and that same login gains the permitted workspace access. Returning the user to CUSTOMER removes workspace access on the next protected request without deleting the account or order history.

Adding STAFF to output enums requires client updates: old clients may not understand the new value. Back up the production database, migrate/deploy the backend and updated frontend in a coordinated maintenance window, and do not assign STAFF until both are live. Old Boolean mutations remain callable but cannot represent STAFF; migrated frontend role controls must use setUserRole. Do not roll back the backend binary against the migrated database after removing admin_memberships. A full rollback requires restoring the pre-migration database backup and compatible application versions; account for writes since that backup before choosing rollback.

## Implementation and documentation locations

- `src/modules/admin/admin.authorization.ts`: permission checks using current role.
- `admin.repository.ts`, `admin.validation.ts`, `admin.schema.ts`, `admin.resolvers.ts`, and `admin-access-cli.ts`: role storage, assignment, filters, contracts, and compatibility.
- `src/modules/books/admin-book.resolvers.ts` and `src/modules/orders/admin-order.resolvers.ts`: operation-specific authorization.
- `src/database/schema.ts`, generated `drizzle/` migration and metadata; regenerate `src/graphql/generated/resolvers.ts` through bun run codegen.
- Extend user/access/book/order/migration/CLI tests. Keep module structure; do not introduce a separate auth system.
- After delivery synchronize README, root SPEC, admin/users/profile specs, historical compatibility notes where relevant, and the frontend contract. Preserve existing implemented behavior until this feature is verified.

## Acceptance criteria

- [x] Signup produces CUSTOMER; a first/existing admin is preserved through migration and the operator grant/revoke command still works.
- [x] ADMIN can assign all three roles idempotently; STAFF/CUSTOMER/guests cannot assign roles or access user management through canonical or compatibility fields.
- [x] STAFF can create/edit books and prices, adjust stock, and read all orders; archive/restore is denied before lookup/validation without a write.
- [x] CUSTOMER cannot access workspace APIs; direct requests, aliases, and mixed operations enforce each permission.
- [x] Viewer and directory filters correctly report all three roles; missing role rows resolve to CUSTOMER.
- [x] Demotion takes effect on the next request; self/final-admin demotion and operator recovery work. Accounts, credentials, shopping, and saved order price/contact snapshots remain intact.
- [x] Fresh/current/supported-legacy migrations preserve admins and data; role constraints and foreign-key cascade prevent invalid/duplicate/orphan role rows.
- [x] Boolean compatibility mutations map true to ADMIN and false to CUSTOMER through the shared setter; legacy query contracts remain usable.
- [x] No staff-facing history access, invitations, or new order workflow is introduced. Activity recording is delivered separately.
- [x] Codegen, bun run test, bun run lint, bun run build, and coordinated frontend browser checks pass.

## Validation and open decisions

`test/staff.test.ts`, the user/access/book/order/CLI regressions, and migration tests cover the permission matrix, role transitions, role filtering, Boolean compatibility mapping, migration of existing administrators, constraints, and cascading role-row deletion. The backend generated resolver types were regenerated, and 65 tests, lint, and production build passed. The coordinated frontend generated its operations and passed 45 tests with `bun run test -- --pool=threads --maxWorkers=2`, lint, and production build. Its full 19-journey Chromium suite passed immediately before the final stale-viewer generation guard, and four targeted role/session browser regressions passed after that guard.

No production migration or deployment was performed. Activity recording is implemented in the separate Activity specification, but its additive migration has not been applied to production. Any future staff permission changes require separate specifications.
