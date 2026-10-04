# The Quiet Shelf API — admin customer directory specification

> **Status:** Implemented. **Date:** 2026-10-03.

## Goal and agreed scope

Let store administrators list registered accounts and grant or revoke admin membership through the existing GraphQL API. The directory shows who can sign in and which of those accounts currently have admin membership. The matching user experience is defined in [the frontend spec](../../../frontend/specs/customers/SPEC.md).

This adds one admin query and one admin mutation to the implemented admin API in [the admin spec](../admin/SPEC.md). It does not create accounts, edit names or emails, or reset passwords. A customer changes their own name and password on `/account/profile`. An admin does that on `/admin/profile`. Resetting another account's password is specified in [the customer details spec](../customer-details/SPEC.md).

## Current system and design choice

- Registered people live in the Better Auth `user` table: `id`, `name`, `email`, `emailVerified`, `image`, `createdAt`, and `updatedAt`. There is no separate customer table.
- `admin_memberships` grants admin access. Absence means customer access. Admins remain the same accounts and can still shop.
- `viewer` already reports the signed-in account's `id` and `CUSTOMER` or `ADMIN` role. Admin queries already require a current session and a fresh membership lookup.
- Order requests store a contact snapshot and an optional `userId`. Legacy guest rows have no account. Matching those rows to accounts by email is already forbidden.
- Call the records **customers** in this feature: every account is a customer, and some customers also have admin membership. A separate user-management resource would describe the same rows.
- Membership writes already exist in `setAdminAccess` for the operator command `bun run admin:access`. The new mutation calls that same repository behavior. The command remains for operators who are not signed in as an admin.
- No database migration. The query and mutation use `user` and `admin_memberships` only. Do not alter generated Better Auth tables.

## Contract

```graphql
enum AdminCustomerRoleFilter {
  ALL
  CUSTOMER
  ADMIN
}
type AdminCustomer {
  id: ID!
  name: String!
  email: String!
  role: UserRole!
  createdAt: String!
}
type AdminCustomersPage {
  total: Int!
  items: [AdminCustomer!]!
}
extend type Query {
  adminCustomers(
    search: String
    role: AdminCustomerRoleFilter = ALL
    limit: Int = 20
    offset: Int = 0
  ): AdminCustomersPage!
}
extend type Mutation {
  setCustomerAdminAccess(userId: ID!, enabled: Boolean!): AdminCustomer!
}
```

- `role` on each item is `ADMIN` when an `admin_memberships` row exists for that user ID, otherwise `CUSTOMER`. Resolve it in the query and on the mutation result; do not persist a second role column.
- `createdAt` is an ISO-8601 UTC string derived from the stored Better Auth timestamp. Do not return `emailVerified`, `image`, `updatedAt`, session rows, password hashes, or account-provider secrets.
- List every registered account, including the signed-in admin. Do not include order-only guest contacts. Do not attach order counts or claim guest orders by email.
- Order by `createdAt` descending, then user ID descending, so the newest registration is first and ties are stable.
- `setCustomerAdminAccess(userId, enabled: true)` grants membership. `enabled: false` revokes it. Both are idempotent and change membership only. The returned `AdminCustomer` is the same account after the write, with the resulting role.
- The target must already exist. An unknown or blank `userId` returns `BAD_USER_INPUT` and writes nothing. Better Auth user IDs are opaque strings, so do not apply the numeric book-ID rule. Do not create an account, password, name, or email.
- An admin may grant or revoke any existing account, including their own, and may revoke the final admin. The operator command can grant access again. Revocation takes effect on the next admin request, including for the caller. A mutation already authorized before revocation may finish.

## Authorization and validation

- `adminCustomers` and `setCustomerAdminAccess` use the existing admin authorization helper. Check the session and current membership before argument validation and before reading or writing accounts. Guests receive `UNAUTHENTICATED`. Authenticated customers receive `FORBIDDEN`, including when the field is aliased or mixed into another operation. A forbidden mutation reveals neither account existence nor the current role.
- Trim `search`, reject more than 100 characters with `BAD_USER_INPUT`, and treat an empty or omitted search as no text filter. Match `name` or `email` with the same literal, case-insensitive SQLite `LIKE` behavior as catalog search: escape `%`, `_`, and `\` so caller wildcards stay literal.
- `role: CUSTOMER` returns accounts with no membership row. `role: ADMIN` returns accounts with a membership row. `ALL` and an omitted role return both. Reject invalid enum values through GraphQL validation.
- `limit` is an integer from 1 to 50. `offset` is a nonnegative integer. Reject other values with `BAD_USER_INPUT`. `total` counts every account matching search and role before pagination. An offset past the end returns an empty `items` list and the filtered total.
- The signed-in admin sees their own row. Revoking that admin takes effect on the next request, same as other admin fields. A listing already authorized before revocation may finish.

## Privacy

- Names and emails are available only through this authorized admin query and mutation result. Public catalog queries, `viewer`, and `myOrders` do not gain account lists or another customer's email.
- Customers cannot call the mutation, and sign-up still accepts no role argument. There is no public promotion endpoint and no profile update.

## Implementation locations

- Existing `src/modules/admin/`: customer listing and membership mutation beside the current viewer, authorization helper, and `setAdminAccess` repository method.
- Existing `src/graphql/schema.ts`, `src/graphql/resolvers.ts`, and generated resolver types: composition and codegen.
- No changes to `src/database/schema.ts`, `drizzle/`, or the operator command's grant/revoke rules.
- Backend API tests for authorization, search, role filtering, pagination, ordering, field privacy, and idempotent grant/revoke, including self-revoke and an unknown user. Names of new files are implementation choices.

## Acceptance criteria and validation

- [x] Guests receive `UNAUTHENTICATED` and customers receive `FORBIDDEN` for `adminCustomers`, including aliased fields and mixed operations, with no account data returned.
- [x] An admin receives every registered account, including their own, with `CUSTOMER` or `ADMIN` resolved from current membership.
- [x] Search matches name or email case-insensitively, treats SQL wildcards as literal text, trims input, and rejects more than 100 characters.
- [x] Role filtering, limit 1–50, nonnegative offset, filtered totals, empty past-end pages, and newest-then-ID ordering behave as specified.
- [x] Responses omit verification, image, session, password, and provider fields. Guest order contacts never appear, and no email match creates an account link.
- [x] An admin can grant and revoke an existing account idempotently. The mutation returns the resulting role, rejects an unknown user without writing, and does not create or edit an account. Revoking the caller or the final admin removes admin API access on the next request. The operator command still performs the same membership change.
- [x] No migration is required. Fresh and current databases answer the query from existing tables.
- [x] Add focused failing tests before implementation. Run backend `bun run test`, `bun run lint`, and `bun run build`. Regenerate resolver types and coordinate frontend codegen when the frontend operation is added.

## Decisions

The directory lists registered accounts rather than order contacts and labels them customers. Admins grant and revoke membership on this API, using the same repository behavior as the operator command. This feature does not edit account details. Role filtering is included so an admin can list staff without scanning every page.

## Verification evidence

Backend tests cover authorization before lookup, literal search, role and page limits, guest-order exclusion, idempotent grant and revoke, unknown users, and self-revoke on the next request. `bun run test` passes 48 tests. `bun run lint` and `bun run build` pass. No migration was added.
