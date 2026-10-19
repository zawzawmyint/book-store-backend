# 🖼️ Book Cover Uploads Implementation Plan

> **Goal:** Let staff manage persistent book covers on the API server and display them across the store, with reproducible seed artwork and a replaceable storage adapter.

---

## 🎯 Objective

Replace placeholder-only presentation with optional real images and a usable staff workflow. **Status: Implemented.** This plan records the implementation of the [API spec](../../../specs/book-cover-uploads/SPEC.md) and [frontend spec](../../../../frontend/specs/book-cover-uploads/SPEC.md).

---

## 📦 Scope

**In scope**

- Local disk adapter, image validation/normalization, authenticated upload/removal, public media, additive database/GraphQL contracts and Activity support.
- Saved-book cover panel, storefront/bag rendering, original seed artwork and explicit offline import, safe operator cleanup, deployment documentation and verification.

**Out of scope**

- S3 adapter/cutover execution, image galleries, browser cropping, direct-to-cloud upload, arbitrary URL ingestion and historical order images.
- Application implementation during this documentation request.

---

## ⚙️ Assumptions & Constraints

**Technical**

- Separate frontend/backend Git repositories; both use branch **feat/book-cover-uploads**, created from freshly fetched and fast-forwarded `main` on 2026-10-16. Keep coordinated changes in both.
- Bun **1.3.14**, Node.js **24+**, existing Express/Apollo/Drizzle and frontend patterns; SQLite and PostgreSQL parity is required. Use existing module/service/repository boundaries and generated schema tooling.
- One API instance with persistent writable disk initially. Local disk is not shared automatically across multiple hosts. Back up database and uploads together.
- Input **5 MiB**, **20,000,000 pixels**, **10,000 pixels per edge**; output single-frame WebP quality **85**, contained within **800 × 1200**, no enlargement; at most **two** concurrent decodes per process.
- Write tests for observable behavior before implementation, confirm the intended failure, implement minimally, rerun and refactor. Never edit generated code or migration SQL by hand in place of generation.

**Product / Business**

- Staff/Admin use existing `MANAGE_CATALOG`; cover saves are independent of book-detail saves. Existing synthetic covers remain the fallback.
- The approved seed direction is twelve original demo covers with recorded provenance. The complete collection is bundled and visually reviewed for readable text.

**Dependencies**

- Sharp 0.35.5 is the delivered maintained decoder. No storage-provider dependency is required for the local adapter.
- The API public media base and deployment persistent volume must be configured before rollout.

---

## 🧩 Proposed Approach

The browser sends bounded raw image bytes to a permission-protected REST endpoint. The cover service normalizes bytes, calls an injected local `CoverStorage`, and atomically updates book metadata/revision and Activity. GraphQL exposes nullable cover metadata, while anonymous `/media/covers/:filename` serves immutable files. New keys on replacement avoid cache collisions. The UI treats every image as optional.

**Storage contract:** `put(key: string, bytes: Uint8Array): Promise<void>`, `remove(key: string): Promise<void>`, `publicUrl(key: string): string`. Delivered files below were new for this feature; existing paths were inspected.

- Existing API wiring: [src/app.ts](../../../src/app.ts), [src/server.ts](../../../src/server.ts), [src/config/env.ts](../../../src/config/env.ts).
- Existing database boundary: [src/database/schema.ts](../../../src/database/schema.ts), [PostgreSQL schema](../../../src/database/postgresql/schema.ts), [store types](../../../src/database/store.types.ts), [SQLite store](../../../src/database/sqlite/store.ts), [PostgreSQL store](../../../src/database/postgresql/store.ts). Generate migrations under both `drizzle/` trees.
- **New** API files: `src/modules/covers/cover.storage.ts`, `local-cover.storage.ts`, `cover.image.ts`, `cover.repository.ts`, `cover.service.ts`, `cover.routes.ts`, `cover-seed-cli.ts`, `cover-cleanup-cli.ts`; **new** `seed-assets/covers/manifest.json` and finished artwork.
- Existing books/Activity modules, seed routines and GraphQL composition gain additive metadata and enum values. Add public bounded `bookCovers(ids)` lookup for guest bags.
- Existing UI: [BookFormPage.tsx](../../../../frontend/src/features/admin/pages/BookFormPage.tsx), [BookCover.tsx](../../../../frontend/src/features/books/components/BookCover.tsx), [operations.graphql](../../../../frontend/src/operations.graphql), [catalog refresh](../../../../frontend/src/features/admin/admin-data.ts). **New** `src/features/admin/components/BookCoverEditor.tsx`, `src/features/admin/cover-api.ts` and `src/features/cart/use-cart-covers.ts` in frontend.
- **Configuration additions:** API `COVER_STORAGE_DRIVER`, `COVER_UPLOAD_DIR`, `COVER_PUBLIC_BASE_URL`; frontend optional `VITE_API_URL`. **Commands:** backend `seed:covers` and `covers:cleanup`; cleanup defaults to dry run and requires stopped writers.
- **Compatibility:** additive GraphQL fields/tables columns preserve old clients and data. `COVER` Activity enum expansion requires coordinated frontend generation/labels. New-book creation now stays in the saved edit view to allow a cover upload. Guest-cart persistence remains unchanged.

**Review focus:** stale replacement/removal, authorization loss mid-upload, file/DB partial failures, seeding after explicit removal, and a failed image URL followed by a valid replacement. The tasks below assign verification for each.

---

## 🚀 Execution Plan

1. **Define portable cover persistence and contracts** — _(role: backend)_ — additive schemas, migrations and typed book results.

   Delivered: update both database schemas/stores and `store.types.ts`, the existing books schema/types/repositories/resolvers, `src/graphql/schema.ts`, and Activity validation. `CoverMetadata = { key: string; width: number; height: number }` is committed through `createCoverRepository.save(bookId, expectedRevision, metadataOrNull, actor)`, which uses revision-conditioned updates and transactional Activity insertion. It includes `HTTP` actor source, `COVER` changed field, bounded `bookCovers(ids)`, and live account-cart cover mapping.

   Delivered coverage is consolidated in `test/book-covers.test.ts`, `test/book-covers-api.test.ts`, and `test/cover-operations.test.ts`, with equivalent PostgreSQL parity scenarios.

2. **Implement local storage and bounded normalization** — _(role: backend)_ — durable complete WebP objects behind the storage contract.

   Delivered `cover.storage.ts`, `local-cover.storage.ts`, and `cover.image.ts` expose the storage contract and `normalizeCover(bytes, contentType)`. Sharp enforces image limits and normalization; the local adapter writes through a temporary directory then atomically renames on the same filesystem.

   Delivered coverage for those cases is consolidated in `test/cover-operations.test.ts` and `test/book-covers-api.test.ts`, including a real animated-PNG fixture and bounded `acTL` chunk validation.

3. **Connect authenticated write routes and public delivery** — _(role: backend)_ — usable API with predictable failure recovery.

   Create `cover.repository.ts`, `cover.service.ts`, `cover.routes.ts`; inject dependencies from `app.ts`/`server.ts` and configuration from `env.ts`. Repository uses Task 1's atomic persistence; service calls Task 2 before committing. Wire PUT/DELETE/GET/HEAD, exact JSON error contracts, strict Origin/CORS, verified session/current permission, raw body bounds, no-store write results, and immutable public headers. Recheck permission at commit; clean abandoned new objects best-effort and defer deleting old objects.

   First extend **new** `test/book-covers-api.test.ts`: Staff/Admin success, guest/unverified/Customer/revoked-role rejection, invalid origin/preflight, malformed If-Match, stale revision, corrupt/oversized body, missing file, traversal, storage/database failure and restart persistence. Include role revocation during processing and fake alternate storage. Assert old reference survives failures and original errors survive cleanup failure. Run `bun run test -- test/book-covers-api.test.ts`; generate resolver types with `bun run codegen`, run affected tests, then commit.

4. **Prepare and import reviewed seed artwork** — _(role: backend)_ — reproducible offline images for every sample book.

   Read every `sampleBooks` entry; create `seed-assets/covers/manifest.json` with stable slug, exact title/author, filename and provenance. Produce a representative set of original demo cover artwork and obtain visual feedback before finishing the collection. For actual generation load the applicable creative/image skills. Compose accurate typography, export portrait assets, inspect at card and detail size, then finish remaining entries. Keep the generated artwork out of runtime source directories.

   Delivered `cover-seed-cli.ts` and `seed:covers` reuse normalization/storage and the atomic null/revision-zero attach operation. Seed coverage is consolidated in `test/cover-operations.test.ts`; the CLI was exercised only at `.delivery-work/cover-cli-fixture`.

5. **Add maintenance and deployment configuration** — _(role: backend)_ — recoverable local-media operations.

   Delivered `cover-cleanup-cli.ts` and `covers:cleanup` enumerate only managed unreferenced objects older than 24 hours and default to dry run. Cleanup coverage is consolidated in `test/cover-operations.test.ts`.

   Update backend `.env.example`, `.gitignore`, README, root SPEC and database-support/Activity specs as applicable. Document required public base, persistent disk, root ownership, proxy limits, stopped-writer cleanup, consistent backups, restore and future key-preserving S3 cutover. Verify startup rejects a nonwritable root and unsupported driver with an actionable diagnostic. Commit.

6. **Regenerate frontend data and render covers consistently** — _(role: frontend)_ — all cover surfaces consume optional metadata.

   Start an isolated API with the new schema. Update `src/operations.graphql`, run `bun run codegen`, then extend `BookCover.tsx` and every existing call site: BookCard, BookPage, HomeHero, BookRecommendation, ReadingDiscovery, BooksPage and CartLine. Update related local book types. Add `use-cart-covers.ts` with batched public lookup for guests (50 IDs per request), reuse live account-cart metadata, and preserve saved guest data. Update `activity-data.ts` for `COVER`.

   First create **new** `src/features/books/components/BookCover.test.tsx` for image success, fallback, failed-URL replacement recovery and preserved accessible names, plus **new** `src/features/cart/use-cart-covers.test.tsx` for batch bounds, failed lookup fallback and no guest-storage changes. Extend existing BookPage/HomePage tests only where their observable behavior changes. Run `bun run test -- BookCover use-cart-covers BookPage HomePage`; confirm failed images do not shift layout or block purchasing. Commit.

7. **Build the saved-book cover editor** — _(role: frontend)_ — independent upload/removal with preview and conflict handling.

   Create `cover-api.ts` exposing `uploadBookCover(id, revision, file)` and `removeBookCover(id, revision)` returning the Task 3 response, and `BookCoverEditor.tsx`. Modify `BookFormPage.tsx` so create success navigates to that saved book's existing edit route, retains return context and announces the next action. Keep text-save behavior separate. Add `VITE_API_URL` origin handling and document/proxy `/api/books` and `/media` in `vite.config.ts`, `.env.example` and browser harness configuration.

   First create **new** `src/features/admin/components/BookCoverEditor.test.tsx`: selection/cancel/preview URL cleanup, pending controls, retryable failure, unknown-outcome refetch, role loss, conflict reload with explicit retry, confirmed removal and unrelated unsaved text preservation. Reuse workspace access handling and catalog invalidation from existing helpers. Run `bun run test -- BookCoverEditor`; manually inspect separate-origin credentials/preflight before committing.

8. **Verify the connected staff-to-storefront journey** — _(role: fullstack)_ — evidence across both database providers and browsers.

   Add **new** frontend `e2e/book-covers.spec.ts`; extend `e2e/server.ts` and backend `scripts/test-postgresql.ts` so every run uses a disposable media root and correct public base, cleans it after completion, and never touches development uploads. Cover create → saved edit → upload → homepage/catalog/details/bag → replace → remove → fallback. Include direct Customer API rejection and stale-editor conflict without duplicating decoder cases in the browser. Verify restart persistence in API integration tests. Cross-origin deployment uses a distinct-origin smoke configuration; record the tested origins and results.

   Backend: `bun run codegen`, `bun run test`, `bun run lint`, `bun run build`, `bun run test:postgres`. Frontend against the updated isolated schema: `bun run codegen`, `bun run test`, `bun run lint`, `bun run build`, `bun run test:e2e`. Backend: `bun run test:postgres:browser`. Expected: all exit zero, no schema drift, and isolated media directories removed. Manually verify narrow screens, keyboard confirmation focus, actual 200% browser zoom and representative artwork readability. Fix failures before claiming acceptance.

9. **Reconcile documentation and deliver for review** — _(role: fullstack)_ — accurate completion status and rollback notes.

   After code and checks settle, delegate final documentation reconciliation to the global `spec-updater` agent, with ownership of both feature specs, root SPEC/README changes, env examples and affected Activity/database docs; no concurrent edits to those files. If unavailable, perform it in the main agent. Review its diff/gaps, record verification evidence, and mark Implemented only when every acceptance criterion passes. Preserve Proposed status for unverified work. Keep corresponding frontend/backend changes reviewable; deployment and S3 migration are separate actions.

**Delivery record (2026-10-19).**

Steps 1–7 are delivered: local `CoverStorage` injection, Sharp normalization with bounded PNG `acTL` chunk validation for APNG rejection, raw revision-guarded REST writes, immutable media, dual-provider additive migrations, `COVER` Activity records, twelve bundled/provenanced demo covers, seed and stopped-writer cleanup commands, GraphQL/guest lookup, shared image rendering, and the saved-book editor. The local seed CLI was verified only at `.delivery-work/cover-cli-fixture` (12 imports, then 12 skips on rerun); runtime local data was not seeded. Step 8 evidence includes a revocation race observed red then green, final backend SQLite **319 passed / 2 skipped / 321** across **56** files, PostgreSQL **41/41**, backend lint/build, frontend **276/276** unit tests across **51** files, frontend lint/build (with the existing bundle-size warning), and SQLite browser **73/73**, plus a 200% Edge Chromium browser journey with cross-port CORS, conflict retry, focus restoration, and unsaved-detail preservation. The full PostgreSQL browser run passed **72/73**; its pre-existing archived-cart setup race was corrected in the test by waiting for visible add-to-bag confirmation, and the focused rerun passed **1/1**. Compiled-app smoke checks passed for SQLite and PostgreSQL.

---

## ✅ Acceptance Criteria

**Functional**

- [x] Staff/Admin upload, preview, replace and remove one persistent cover per saved book; stale requests never overwrite newer work.
- [x] All specified storefront/workspace/bag surfaces render images and recover using the existing fallback.
- [x] Seed import covers all sample entries offline and never replaces staff choices or restores intentional removals.
- [x] Application logic works with a fake alternate storage adapter; the documented future S3 cutover preserves keys and the frontend contract.

**Non-functional** (performance, security, accessibility, reliability)

- [x] Authorization, Origin checks, byte/pixel/decode bounds, safe file paths and exact response/cache policies pass integration tests.
- [x] SQLite/PostgreSQL migrations and transactions preserve existing catalog data and Activity integrity.
- [x] File/database failures preserve the current cover; persistent-volume restart, cleanup and backup/restore guidance are verified.
- [x] Responsive layout, screen-reader feedback, keyboard interaction and actual 200% zoom meet the frontend spec.

---

## 🧪 Validation Plan

**Manual tests**

- Review representative seed designs before collection completion, then inspect every finished title/author at small and large sizes.
- Exercise full staff workflow, separate-origin upload/media, API restart, responsive layout, keyboard navigation and actual 200% zoom.

**Automated tests**

- Tasks 1–5 own backend migration, integration, storage, normalization, seed and cleanup behavior; Tasks 6–7 own selected UI transition tests; Task 8 owns the connected browser journey and required checks.
- Use temporary storage plus isolated databases. Verify stale races, revoked permission, DB/file failures, intentional seed removal and failed-image recovery explicitly.

**Rollback / mitigation**

- Deploy API additive contracts before UI consumption; coordinate Activity enum changes. Revert UI/API binaries if needed while preserving columns and files. Do not roll back by deleting media or resetting databases.
- Retain local files until a later verified S3 cutover is accepted. Restore database and corresponding upload snapshot together if data recovery is needed.

---

## ⚠️ Risks & Open Questions

**Risks**

- **Risk:** Ephemeral or multi-host disk loses or inconsistently serves images. — _Mitigation:_ require a persistent single-instance volume; move to shared storage before horizontal scaling.
- **Risk:** File storage and database cannot share a transaction. — _Mitigation:_ publish first, compare revision and audit atomically, remove failed new objects best-effort, and clean old orphans during a stopped-writer maintenance window.
- **Risk:** Image processing adds native runtime and memory requirements. — _Mitigation:_ verify the selected decoder on Node 24/Windows/deployment OS and cap bytes, pixels and concurrent decodes.
- **Risk:** Demo artwork could be mistaken for the actual publisher edition. — _Mitigation:_ document provenance and demo interpretation; review artwork before seeding and allow staff replacement.

**Open questions** _(blockers for implementation)_

- No product blocker remains for the local-storage/API slices. The approved original demo artwork collection is bundled and its text was visually reviewed.
- Actual production persistent-volume path and public media base must be supplied before deployment; local/test values can be explicit fixture configuration.
