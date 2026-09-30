# Repository guidance

This repository owns the Express, Apollo Server, and SQLite API. Read `README.md` for setup and `SPEC.md` when changing API behavior.

## Commands

- Install dependencies: `npm ci`
- Run locally: `npm run dev`
- Check changes: `npm test` and `npm run build`
- Seed the sample catalog only when intended: `npm run db:seed`

## Code boundaries

- Define the public GraphQL contract in `src/graphql/schema.ts` and connect it in `src/graphql/resolvers.ts`.
- Put input and business rules in `src/modules/*/*.service.ts`; put parameterized SQL in repositories.
- Keep order pricing and stock changes in one database transaction. Calculate totals from stored prices, not client values.
- Add schema changes through `src/database/migrations.ts`. Do not edit or commit the SQLite files in `data/`.
- Keep configuration in `src/config/env.ts` and update `.env.example` when an environment variable changes.

## Cross-repository changes

The frontend is a separate repository. After changing this API's schema, update the frontend operations if needed and run `npm run codegen` in the frontend while this API is running. Commit the resulting generated TypeScript file with the frontend change.
