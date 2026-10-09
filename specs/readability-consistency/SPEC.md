# Backend readability and consistency

**Status:** Proposed  
**Date:** 2026-10-09

## Goal

Make backend dependencies, service inputs, and database code easier to read and review while preserving existing behavior. Deliver small refactoring passes, using the user's current resolver composition edits as the starting point.

## Scope

In scope:

- Dependency assembly and naming in application setup and GraphQL composition.
- Consistent repository dependency types and object inputs for services with multiple related filters.
- Readable local names in database adapters and consistent PostgreSQL identifier spelling.
- Documentation of these conventions and verification of behavior preservation.

Out of scope:

- Frontend changes, new features, dependency upgrades, and performance redesigns.
- GraphQL schema changes, database schema changes, migrations, or generated-file edits.
- A shared abstraction that combines SQLite and PostgreSQL implementations.
- Admin service extraction or module restructuring; assess those separately only when concrete business logic justifies them.

## Current observations

- [Resolver composition](../../src/graphql/resolvers.ts) already separates repository creation from resolver creation, but mixes `roles`, `adminBooks`, `books`, and explicit `*Repository` / `*Resolvers` names.
- [Application setup](../../src/app.ts) nests payment repository construction inside payment service creation.
- Book and order services use named repository contracts, while several newer services use inline `ReturnType<typeof create...Repository>` dependencies.
- Admin book listing accepts an input object; admin order listing accepts several positional filters.
- Both database adapters use terse schema aliases and row/value names. Some database helpers spell PostgreSQL differently.
- [Payment service](../../src/modules/payments/payment.service.ts) contains multiple variable declarations on one line.

These are readability opportunities. Existing provider differences and query-only resolver shapes are intentional and do not require structural unification.

## Conventions

### Dependency assembly

- Construct dependencies in readable order: repositories, services or resolvers, then composition.
- Use names that identify the actual dependency: `adminRepository`, `paymentRepository`, `adminBookResolvers`, and `dashboardResolvers`.
- Use `*Repository`, `*Service`, and `*Resolvers` consistently for factory results. Do not create a service variable when no service is needed.
- Split unrelated variable declarations onto separate statements.
- Keep transaction-scoped dependencies inside the transaction. In particular, the payment repository's admin order repository must continue to use its transaction store.
- Preserve GraphQL spread order and field ownership; naming changes must not introduce resolver overrides.

### Service contracts

- Import a named repository type from its owning module instead of repeating inline factory-derived types throughout services.
- Preserve existing explicit contracts such as `CatalogRepository` and `OrderRepository`.
- Where a repository has no explicit contract, export an inferred alias such as `AdminOrderRepository = ReturnType<typeof createAdminOrderRepository>`. Do not introduce duplicate interfaces solely for appearance.
- Convert service inputs with multiple related filters to named objects, starting with admin order listing. Keep GraphQL argument names, defaults, validation, and response shapes unchanged; update all internal callers together.
- Keep simple scalar inputs where they are already clear. Do not mechanically wrap every argument in an object.
- Keep validation and business rules in services and persistence in repositories. This pass does not add empty service wrappers around Admin resolvers.

### Database readability

- Prefer descriptive names such as `schema`, `values`, `row`, and `firstRow` where they clarify adapter code.
- Spell PostgreSQL consistently in internal identifiers, including connection/readiness helpers. Keep the external provider value `postgresql` unchanged.
- Preserve SQLite query construction versus PostgreSQL store construction as distinct responsibilities.
- Keep provider-specific types, SQL, locks, transaction isolation, SQLite serialization, and store caching unchanged.
- Keep dashboard query construction inside the PostgreSQL transaction that owns its reads.
- Do not rename tables, columns, indexes, constraints, exported schema entities, or migration files for style alone.

## Delivery passes

1. **Composition and naming:** finish the naming convention in [resolvers](../../src/graphql/resolvers.ts) and [app setup](../../src/app.ts), preserving the user's edits. Verify application bootstrap and affected resolver behavior before proceeding.
2. **Service contracts:** introduce named repository aliases where needed and update multi-filter service inputs with their callers. Review one module at a time; preserve validation and return values.
3. **Database readability:** update descriptive locals in [SQLite queries](../../src/database/sqlite/store.ts) and [PostgreSQL store](../../src/database/postgresql/store.ts), then update relevant helper identifiers and references. Review transaction-sensitive changes separately from simple renames.
4. **Reconcile documentation:** record the conventions in project guidance after they are delivered. Mark this spec Implemented only after every in-scope criterion below is verified.

Each pass should produce a small diff that can be reviewed independently. No deployment or database migration is required.

## Behavior preservation

- Authentication, authorization, ownership checks, and permission errors remain identical.
- Public invalid book lookups still return null; strict admin ID validation still rejects invalid inputs.
- Pagination, filter defaults, Unicode search, ordering, and empty-result behavior remain identical.
- Payment idempotency, reconciliation, side-effect order, refunds, inventory changes, and activity recording remain identical.
- GraphQL contracts and generated output remain unchanged.
- SQLite and PostgreSQL retain equivalent application outcomes without losing their provider-specific safeguards.

## Acceptance criteria

- [ ] Dependency names consistently describe their roles in the scoped composition files.
- [ ] Nested payment dependency construction and unrelated combined declarations are made readable without changing initialization or side-effect order.
- [ ] Scoped services use named repository types; existing useful contracts are retained.
- [ ] Admin order listing uses a named input object internally, with all callers updated and the external API unchanged.
- [ ] Scoped database locals and PostgreSQL helper names are readable and consistent.
- [ ] Transaction ownership, isolation, locking, caching, and SQLite serialization are preserved.
- [ ] No generated files, schema definitions, migrations, or frontend behavior are changed.
- [ ] Existing user changes are preserved and documentation describes only verified delivered conventions.
- [ ] Relevant checks pass for each pass, and final backend tests, lint, and build pass.

## Validation

This is behavior-preserving refactoring. Establish a passing baseline, refactor, and rerun existing relevant tests. A rename does not require an artificial failing test. Add characterization tests only where a meaningful behavior lacks coverage; use the project's failing-test workflow if a discovered issue requires a behavior change.

- Composition: run bootstrap, API, async resolver, and authorization coverage as relevant to the changed dependencies.
- Services: run affected admin books, admin orders, dashboard, activity, order, or payment tests. Check defaults, invalid inputs, permissions, and returned results when signatures change.
- Database adapters: run portable repository and database parity coverage, including `bun run test:postgres` against the disposable test database. Include payment and transaction coverage when transaction-scoped wiring changes.
- Final backend checks: `bun run test`, `bun run lint`, and `bun run build`. Inspect the diff for accidental API, schema, migration, or generated-file changes.
- Browser verification: exercise affected workspace search, order filters, and dashboard links when resolver or service wiring changes. Run existing frontend E2E coverage for affected journeys when needed; adapter-local naming changes alone do not require a new browser test.
- Documentation-only changes: check Markdown links and `git diff --check`; do not run runtime tests solely for prose edits.

## Risks and rollback

- Internal identifier changes can miss references: update callers together and use the build to verify them.
- Dependency movement can change transaction scope or initialization: keep construction in its existing scope and verify transaction-sensitive behavior before merging that pass.
- Broad style sweeps can make review harder: keep each pass bounded and avoid unrelated formatting churn.
- If a pass introduces a regression, revert only that pass's changes while preserving the user's pre-existing edits. No database rollback is expected because schema and persistence contracts are unchanged.
