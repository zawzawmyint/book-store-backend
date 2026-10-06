# The Quiet Shelf API — user directory naming specification

> **Status:** Implemented. **Date:** 2026-10-05.

## Goal and scope

Use **User** consistently for registered identities in the administrative directory, detail lookup, access assignment, and password management. The directory includes customers and administrators, so its contracts must not describe every identity as a customer. Coordinate delivery with [the frontend specification](../../../frontend/specs/users/SPEC.md).

This naming and compatibility delivery was extended by the implemented [staff roles specification](../staff/SPEC.md). Customer, Staff, and Admin can all shop; Staff permissions, role storage, and deployment constraints are defined there.

## Vocabulary

- **User:** a registered identity in Better Auth's `user` table, regardless of role.
- **Role:** the server-resolved authorization classification: `UserRole { CUSTOMER STAFF ADMIN }`.
- **Customer:** a shopping participant or the buyer captured in an order. Keep order fields such as `customerName`, contact snapshots, and guest-order terminology.
- **Account:** the existing authentication/provider record, or personal account settings. Do not rename Better Auth's `account` table or `/account/*` profile and order routes.
- **Admin:** a permission level and the administrative workspace. Keep the existing admin module and operator command.

## Canonical GraphQL contract

```graphql
enum AdminUserRoleFilter { ALL CUSTOMER STAFF ADMIN }

type AdminUser {
  id: ID!
  name: String!
  email: String!
  role: UserRole!
  createdAt: String!
}

type AdminUsersPage { total: Int!, items: [AdminUser!]! }

extend type Query {
  adminUsers(
    search: String
    role: AdminUserRoleFilter = ALL
    limit: Int = 20
    offset: Int = 0
  ): AdminUsersPage!
  adminUser(id: ID!): AdminUser!
}

extend type Mutation {
  setUserRole(userId: ID!, role: UserRole!): AdminUser!
  resetUserPassword(userId: ID!, newPassword: String!): AdminUser!
}
```

`viewer`, `AdminUser`, and compatibility `AdminCustomer` may return all three roles. `setUserRole` is the canonical assignment mutation and requires Admin's user-management permission. The old Boolean mutations are deprecated compatibility fields; true assigns Admin and false assigns Customer.

## Compatibility and release

An immediate removal of the customer-named fields, types, or role-filter enum would break existing GraphQL clients. Use an additive release:

1. Retain `adminCustomers`, `adminCustomer`, `setCustomerAdminAccess`, and `resetCustomerPassword` with their existing types, argument defaults, and nullability. `setUserAdminAccess` is also retained as a deprecated Boolean compatibility mutation.
2. The customer-named fields and Boolean access mutation are deprecated. Compatibility role filters now include Staff because they use the shared `UserRole` model.
3. Both contracts use the same authorization, validation, repository operations, response projection, and error handling. Legacy wrappers must not fork business logic or return newly renamed types in place of their original declared types.
4. Deploy the additive API before the frontend that uses it. Regenerate backend resolver types from the schema.
5. Remove legacy contracts only in a separately specified breaking release after known clients migrate. Their removal has no automatic deadline in this delivery.

The new frontend works with the new backend; it is not expected to work with an old backend. The old frontend must continue working with the additive backend. Roll back the frontend first if rolling back both repositories.

## Rules preserved

- Directory and management operations require a valid session and current Admin role before validation or user lookup. Guests receive `UNAUTHENTICATED`; Customer and Staff roles receive `FORBIDDEN`, without learning whether a target exists.
- List all registered users, including the caller. Do not include guest-order contacts or associate orders by email.
- Search trims, accepts at most 100 characters, and matches name/email case-insensitively with literal SQL wildcard handling. Pagination accepts limit 1–50 and nonnegative offset. Total is filtered before pagination; order by registration time descending, then user ID descending.
- Return only ID, name, email, role, and UTC ISO registration time. Preserve existing unknown-user and invalid-input errors.
- `setUserRole` is idempotent, applies only to an existing exact user ID, and changes no credentials, sessions, or orders. Self-demotion and final-admin demotion remain allowed; access changes on the next protected request.
- Password reset accepts 8–128 characters, uses the existing Better Auth hasher, removes the target's sessions, and rejects self-reset. Own-password changes stay in the profile flow. Preserve rejection of targets without password credentials.

## Implementation and documentation boundaries

- In `src/modules/admin/admin.repository.ts`, rename `listCustomers` → `listUsers`, `getCustomer` → `getUser`, `resetCustomerPassword` → `resetUserPassword`, `CustomerInput` → `UserInput`, and `customerSelect` → `userSelect`. Keep the already accurate `setAdminAccess` and `isAdmin` names.
- In `admin.validation.ts`, rename `adminCustomersInputSchema` → `adminUsersInputSchema`, `customerUserIdSchema` → `userIdSchema`, and `customerPasswordSchema` → `userPasswordSchema`.
- Update `admin.schema.ts`, `admin.resolvers.ts`, affected composition/type references, test descriptions, and fixtures. Rename `test/admin-customers.test.ts` → `test/admin-users.test.ts` and `test/customer-details.test.ts` → `test/user-details.test.ts` with matching assertions.
- Generate `src/graphql/generated/resolvers.ts` through `bun run codegen`; never edit generated types manually.
- The staff migration replaced `admin_memberships` with `user_roles`, preserving existing administrators as Admin and preserving IDs, credentials, and order links. No configuration or dependency changes were required; the operator command remains a Boolean Admin/Customer recovery path.
- After delivery, update `SPEC.md`, `README.md`, and relevant admin/profile/customer feature specs to describe canonical names and compatibility. Keep this as the authoritative user-directory spec and leave short historical cross-references in the older customer-directory/detail specs. Mark this spec Implemented only when criteria pass.

## Implemented staff extension

The User vocabulary accommodates Staff without another directory rename. `user_roles` stores a single privileged role; absence is Customer. The fixed Staff permission set and migration/rollback rules are in [the staff roles specification](../staff/SPEC.md). [Activity history](../activity/SPEC.md) now records supported role and password-management actions; expanded staff permissions remain deferred.

## Acceptance criteria

- [x] Canonical queries and mutations expose the specified types and preserve existing results, validation, ordering, pagination, and errors.
- [x] Legacy GraphQL operations still validate and behave identically through shared implementations; schema introspection reports field deprecations and replacements.
- [x] Guests and customers cannot use canonical or legacy administration fields, including aliases and mixed operations.
- [x] Role assignment, self-demotion, unknown targets, and password reset/session revocation retain their specified behavior.
- [x] Internal canonical code and tests use User terminology; customer-named API identifiers remain only for deliberate compatibility or shopping concepts.
- [x] Existing admins were preserved by the coordinated Staff migration; Customer, Staff, and Admin can shop.
- [x] Backend codegen, `bun run test`, `bun run lint`, and `bun run build` pass; the coordinated frontend's browser journey passes against this API.

## Validation and unresolved decisions

`test/admin-users.test.ts` and `test/user-details.test.ts` cover the canonical directory/detail operations, authorization and validation, role changes, and password-reset session revocation. Compatibility fields are deprecated wrappers over shared resolver behavior and retain their original declared customer-named types. The Staff role extension is verified in [the staff roles specification](../staff/SPEC.md). Legacy-contract removal timing remains a separate decision.
