# The Quiet Shelf API — admin customer details specification

> **Status:** Implemented. **Date:** 2026-10-04.

## Goal and agreed scope

Let a signed-in admin read one registered account and set a new password for someone else. The matching screen is defined in [the frontend spec](../../../frontend/specs/customer-details/SPEC.md).

The signed-in person still changes their own name and password through Better Auth, specified in [the profile spec](../profile/SPEC.md). Customers use `/account/profile`. Admins use `/admin/profile`. This feature does not create accounts, edit names or emails, change membership, or rewrite order snapshots. Grant and revoke stay on `setCustomerAdminAccess`.

## Current system and design choice

- Registered people live in the Better Auth `user` table. `admin_memberships` grants admin access. The directory already returns `AdminCustomer` with `id`, `name`, `email`, `role`, and `createdAt`.
- Email-and-password credentials live on the Better Auth `account` row whose `providerId` is `credential`. The password column stores a hash. Sessions live in the Better Auth `session` table.
- Better Auth `change-password` requires the current password and acts only on the signed-in user. An admin cannot use it to set another person's password. This feature adds an admin mutation that replaces the hash and deletes that user's sessions.
- No database migration. Use the existing `user`, `account`, and `session` tables.

## Contract

```graphql
extend type Query {
  adminCustomer(id: ID!): AdminCustomer!
}
extend type Mutation {
  resetCustomerPassword(userId: ID!, newPassword: String!): AdminCustomer!
}
```

- `adminCustomer` returns the same `AdminCustomer` shape as the directory: `id`, `name`, `email`, `role`, and ISO-8601 UTC `createdAt`. Role comes from current membership. Omit verification, image, sessions, password hashes, and provider secrets.
- An unknown or blank id returns `BAD_USER_INPUT` with the message `User was not found` and writes nothing. Better Auth user IDs stay opaque strings.
- `resetCustomerPassword` sets a new password for an existing account other than the caller. It does not require the current password. The response is that same `AdminCustomer` after the write. Do not return or log the new password or the hash.
- Hash the new password with the same Better Auth hasher used at sign-up, and store it on that user's credential account. In the same transaction, delete every `session` row for that user. Afterward, the previous password is rejected at sign-in, every previous cookie for that user no longer resolves a session, and the new password signs in.
- Reject a missing credential account with `BAD_USER_INPUT` and write nothing.
- Reject the caller's own user ID with `BAD_USER_INPUT` and the message `Change your own password from your profile.` Write nothing and delete no sessions.
- Leave name, email, image, membership, and stored order `customer_name` and `email` unchanged. Resetting another admin's password removes that admin's sessions and leaves their membership in place.
- A second reset of the same account is allowed. Each success replaces the hash and deletes that user's sessions again.
- Do not add a password command to `bun run admin:access`.

## Authorization and validation

- Both fields use the existing admin authorization helper. Check the session and current membership before argument validation and before reading or writing. Guests receive `UNAUTHENTICATED`. Authenticated customers receive `FORBIDDEN`, including when the field is aliased or mixed into another operation. A forbidden call reveals neither account existence nor whether a password changed.
- `newPassword` is the raw string, 8–128 characters, with no trim. Reject any other length with `BAD_USER_INPUT` and write nothing. Confirmation that the two typed passwords match belongs to the storefront; the API accepts one value.
- The current Better Auth rate limit stays on `/api/auth/change-password`. This mutation does not go through that route.

## Implementation locations

- Existing `src/modules/admin/`: one customer read and the password reset beside the directory, using the current authorization helper.
- Existing `src/graphql/schema.ts`, `src/graphql/resolvers.ts`, and generated resolver types: composition and codegen.
- No changes to `src/database/schema.ts`, `drizzle/`, the operator command, or the Better Auth `update-user` and `change-password` routes.
- Backend API tests for authorization, an unknown user, a self reset, an out-of-range password, a successful reset, session removal, and unchanged account fields. Names of new files are implementation choices.

## Acceptance criteria

- [x] Guests receive `UNAUTHENTICATED` and customers receive `FORBIDDEN` for `adminCustomer` and `resetCustomerPassword`, with no account data and no password change.
- [x] An admin can read any registered account, including their own, with the directory fields only.
- [x] An admin can set a new 8–128 character password for another account. The old password fails sign-in, the new password succeeds, and every session for that account is gone. Name, email, role, and past order snapshots stay unchanged.
- [x] A blank or unknown user, a missing credential account, the caller's own ID, and a password outside 8–128 characters write nothing.
- [x] Responses and logs omit the password and its hash. No migration is required. `change-password` still requires the current password for the signed-in user.
- [x] Add focused tests before implementation. Run backend `bun run test`, `bun run lint`, and `bun run build`.

## Verification evidence

`test/customer-details.test.ts` covers an admin reading their own account and another account, hidden password fields, blank and unknown ids, guest and customer denial, a reset that removes every session, a second reset, an untrimmed password, a rejected self reset, out-of-range passwords, an account with no credential, and another admin whose membership stays. `bun run test` passes. `bun run lint` and `bun run build` pass. No migration was added.
