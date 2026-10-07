# Local demo login

> **Status:** Implemented.

## Goal

Provide repeatable local accounts for the optional storefront demo controls without
adding a product API, schema, or permission bypass. The matching UI behavior is in
[the frontend demo-login specification](../../../frontend/specs/demo-login/SPEC.md);
normal account behavior remains defined by [the authentication specification](../authentication/SPEC.md).

## Local seed command

Run `bun run demo:seed` from this backend directory against the configured local
database. It creates or verifies these Better Auth email-and-password accounts:

- `demo-customer@example.com` — Customer
- `demo-staff@example.com` — Staff
- `demo-admin@example.com` — Admin

They share the local-only password `BookstoreDemo123!`. The command uses normal
Better Auth signup/sign-in and the server-owned role repository. It creates no
catalog or order data and does not reset existing catalog or order data.

## Repeatability and safeguards

Re-running the command preserves existing demo account IDs and data, verifies the
known password, restores the three assigned roles, and removes the seed-created
authentication sessions. If a demo account exists with a different password, the
command fails before creating accounts or restoring any demo roles. Reset that
password manually through the existing Admin user-management UI before re-seeding.

The command refuses `NODE_ENV=production` before opening the database, so it makes
no production database writes. It has no HTTP endpoint.

## Acceptance criteria

- Each account can sign in through the normal Better Auth route and receives its
  Customer, Staff, or Admin viewer role.
- A repeated seed preserves account IDs and restores the intended roles.
- Production seeding is rejected before the database is opened.

## Verification

Backend tests cover normal sign-in and viewer-role resolution for all three
accounts, repeat-seed ID preservation, failed credential preflight without account
or role changes, and the production refusal. The coordinated frontend browser
coverage verifies each demo control against the live local API.
