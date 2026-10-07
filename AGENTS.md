# Repository guidance

This repository owns the Express, Apollo Server, Drizzle, and SQLite API. Read `README.md` for setup and `SPEC.md` when changing API behavior. For authentication or account order work, also read `specs/authentication/SPEC.md`.

## Spec-driven and test-driven workflow

Use this order for future implementation work. Existing specs describe the current system; do not treat their `Implemented` status as evidence that earlier work followed this process.

1. Before changing behavior, create or update `specs/<feature>/SPEC.md` with **Status: Proposed**. For a small change documented only in `SPEC.md`, add a clearly labeled proposed section; preserve its description of current behavior until delivery. State the HTTP/GraphQL contract, validation and authorization rules, data and migration effects, edge cases, and testable acceptance criteria. For a bug, specify the correct behavior and regression case. Coordinate breaking contracts with the frontend spec before editing either implementation.
2. Select one acceptance criterion and add the smallest relevant automated test first. Prefer a service or API test for behavior and a migration test for schema changes. Run it and confirm it fails for the intended missing behavior, rather than a setup error.
3. Implement only enough to pass that test, then refactor with tests green. Repeat the failing-test → passing-test → refactor cycle for each remaining criterion. Generate resolver types and migrations from their source definitions; do not hand-edit generated types.
4. Run the affected tests, then `bun run test`, `bun run lint`, and `bun run build`. Coordinate frontend codegen and browser tests when the API contract or a customer journey changes. Check acceptance criteria manually where automation cannot verify them.
5. Update `SPEC.md` to match the delivered behavior, resolve any proposed section, and mark the feature spec **Status: Implemented** only after its acceptance criteria pass. Include the spec, tests, migration (if any), and implementation in the change for review.

## Commands

- Install reproducibly with Bun 1.3.14: `bun install --frozen-lockfile`. Use `bun install` when changing dependencies and commit `bun.lock`. Node.js 24 or later remains the runtime.
- Run locally: `bun run dev`
- Check changes: `bun run test`, `bun run lint`, and `bun run build`
- Seed the sample catalog only when intended: `bun run db:seed`

## Code boundaries

- Define GraphQL types and resolvers in each module; compose them in `src/graphql/schema.ts` and `src/graphql/resolvers.ts`.
- Regenerate `src/graphql/generated/resolvers.ts` with `bun run codegen` after schema changes. Do not hand-edit it.
- Define input validation and normalization in module-local `*.validation.ts` Zod schemas invoked by services. Keep GraphQL contracts, API input schemas, and persistence schemas separate. Keep business rules in services and Drizzle queries in repositories; preserve input limits and `BAD_USER_INPUT` errors.
- Keep order pricing and stock changes in one database transaction. Calculate totals from stored prices, not client values.
- Define tables and constraints in `src/database/schema.ts`. Generate migrations with `bun run db:generate` and commit SQL and metadata in `drizzle/`. Apply them with `bun run db:migrate`, whose wrapper verifies and adopts supported legacy databases before Drizzle migration tracking. The order-workflow migration deliberately rejects populated pre-workflow orders rather than inventing status history; use an explicit, authorized development reset or a separately designed data migration. Direct `drizzle-kit migrate` bypasses legacy adoption. Do not edit or commit runtime SQLite files in `data/`.
- Keep configuration in `src/config/env.ts` and update `.env.example` when an environment variable changes.
- Keep Better Auth's Express handler before JSON body parsing, derive order identity from the server session, and generate auth tables with `auth.cli.ts` before generating Drizzle migrations. Do not claim legacy guest orders by email.

## Cross-repository workflow

The frontend is a separate repository. After changing this API's schema, update the frontend operations if needed and run `bun run codegen` in the frontend while this API is running. Commit the resulting generated TypeScript file with the frontend change.
