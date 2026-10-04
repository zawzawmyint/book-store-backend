# The Quiet Shelf API — account profile specification

> **Status:** Implemented. **Date:** 2026-10-04.

## Goal

Let a signed-in customer update their own display name and password through the existing Better Auth session. The storefront page is defined in [the frontend spec](../../../frontend/specs/profile/SPEC.md).

Editing another customer's name or email from admin remains deferred. An admin password reset is specified in [the customer details spec](../customer-details/SPEC.md).

## Contract

- Use the existing Better Auth routes. Do not add a GraphQL profile mutation or a public account-administration endpoint.
- `update-user` accepts the signed-in user's name only. The existing database hook trims it and requires 1–120 characters. A missing session is rejected. Email, image, role, and user ID cannot be changed through this request.
- `change-password` requires the current password and a new password of 8–128 characters. A wrong current password is rejected and leaves the stored password unchanged. Revoke other sessions and keep the current browser session.
- After a successful name change, the session user name used by `placeOrder` is the saved name. Existing orders keep their stored `customer_name` and `email`. Do not rewrite history.
- The current Better Auth rate limit applies. Do not log passwords or return password hashes.

## Acceptance criteria

- [x] A signed-in user can rename their account within 1–120 characters. Blank and over-long names are rejected. Checkout and later order requests use the new name.
- [x] A signed-in user can change their password when the current password matches. A wrong current password or an out-of-range new password changes nothing.
- [x] Guests cannot call either route. One user cannot update another user's name or password.
- [x] Email and past order snapshots stay unchanged. No migration is required.
- [x] Add focused tests before implementation. Run backend `bun run test`, `bun run lint`, and `bun run build`.

## Verification evidence

`test/profile.test.ts` covers a trimmed rename, an unchanged email and first-order snapshot, a later order using the new name, rejected email and image updates, a request that cannot rename another account, guest rejection, a wrong current password, a too-short new password, and a successful change that revokes the other session and keeps the current one. The profile tests pass. `bun run lint` and `bun run build` pass. No migration was added.
