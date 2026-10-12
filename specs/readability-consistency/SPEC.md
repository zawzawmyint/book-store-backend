# Backend readability and consistency

**Status:** Implemented

**Date:** 2026-10-12

## Goal

Make backend dependencies, service inputs, and database code easier to read and review while preserving existing behavior.

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

## Delivered refactoring

- [Application setup](../../src/app.ts) constructs `paymentRepository` before `paymentService` and passes the named service to resolver composition.
- [Resolver composition](../../src/graphql/resolvers.ts) constructs repositories first, then explicitly named resolver groups. The existing GraphQL spread order and field ownership remain unchanged.
- Repository-owning modules export named inferred aliases for Admin, Admin Book, Admin Order, Activity, Dashboard, and Payment repositories. Existing `CatalogRepository` and `OrderRepository` contracts remain in place, and `PaymentService` is named for its consumers.
- [Admin order listing](../../src/modules/orders/admin-order.service.ts) receives one internal object with `limit`, `offset`, `status`, and `search`; GraphQL keeps the same arguments, defaults, validation, and response shape.
- SQLite and PostgreSQL adapters use descriptive schema, value, row, and helper names. Internal PostgreSQL connection, readiness, migration, and guard helpers use one spelling; the external `postgresql` provider value remains unchanged.
- Payment service and worker declarations are split where that makes separate state or dependencies clearer. The payment repository retains its transaction-local `adminOrderRepository` construction.

SQLite and PostgreSQL keep their deliberately different query/store responsibilities and provider safeguards. Query-only resolver shapes and Admin's direct repository use remain unchanged.

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

## Delivered scope

1. **Composition and naming:** completed the dependency naming and assembly in application and GraphQL setup without moving initialization or resolver spreads.
2. **Service contracts:** completed named repository aliases and the internal Admin Order list input object with all callers updated.
3. **Database readability:** completed descriptive adapter locals and PostgreSQL helper renames without changing provider-specific SQL, locking, transaction isolation, SQLite serialization, or store caching.
4. **Documentation:** recorded the maintained conventions in [AGENTS.md](../../AGENTS.md).

No deployment, database migration, schema change, generated-file update, or frontend change was required.

## Behavior preservation

- Authentication, authorization, ownership checks, and permission errors remain identical.
- Public invalid book lookups still return null; strict admin ID validation still rejects invalid inputs.
- Pagination, filter defaults, Unicode search, ordering, and empty-result behavior remain identical.
- Payment idempotency, reconciliation, side-effect order, refunds, inventory changes, and activity recording remain identical.
- GraphQL contracts and generated output remain unchanged.
- SQLite and PostgreSQL retain equivalent application outcomes without losing their provider-specific safeguards.

## Acceptance criteria

- [x] Dependency names consistently describe their roles in the scoped composition files.
- [x] Nested payment dependency construction and unrelated combined declarations are made readable without changing initialization or side-effect order.
- [x] Scoped services use named repository types; existing useful contracts are retained.
- [x] Admin order listing uses a named input object internally, with all callers updated and the external API unchanged.
- [x] Scoped database locals and PostgreSQL helper names are readable and consistent.
- [x] Transaction ownership, isolation, locking, caching, and SQLite serialization are preserved.
- [x] No generated files, schema definitions, migrations, or frontend behavior are changed.
- [x] Existing user changes are preserved and documentation describes only verified delivered conventions.
- [x] Relevant checks pass for each pass, and final backend tests, lint, and build pass.

## Validation

This was behavior-preserving refactoring. The implementation established a passing backend baseline, then reran the affected suites after each pass. Naming-only and signature-clarity changes did not receive artificial failing tests.

On 2026-10-12, verification recorded:

- Baseline backend suite: 196 tests in 35 files.
- Composition coverage: 48 tests in 10 files.
- Service coverage: 37 tests in 5 files.
- Final backend suite: 196 tests in 35 files, plus `bun run lint` and `bun run build`.
- PostgreSQL verification: 24 parity tests in 1 file, plus the migration guard and the same built application against both providers.
- Frontend connected journeys: 9 workspace-search and dashboard E2E tests.

The reviewed diff contains no GraphQL schema, database schema, migration, generated-file, or frontend behavior changes.

## Risks and rollback

- Internal identifier changes can miss references: callers were updated together and the build verified the result.
- Dependency movement can change transaction scope or initialization: construction remains in its existing scope, including the transaction-local payment workflow repository.
- Broad style sweeps can make review harder: the delivered change stays within composition, service contracts, and database adapters.
- If a future follow-up introduces a regression, revert only that pass. No database rollback is expected because schema and persistence contracts remain unchanged.
