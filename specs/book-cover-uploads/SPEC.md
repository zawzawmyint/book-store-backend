# Book cover uploads — API specification

> **Status: Implemented. Date: 2026-10-19.** The local-cover implementation and bundled demo artwork are delivered and verified.

Let Staff and Admin manage book covers using API-server disk storage now, with a small replaceable storage boundary for a later S3 migration. Coordinate with the [frontend specification](../../../frontend/specs/book-cover-uploads/SPEC.md) and [implementation plan](../../docs/superpowers/plans/2026-10-16-book-cover-uploads.md).

## Current system and scope

Public and workspace books expose an optional cover. The implementation adds one cover per book, public image delivery, authenticated replacement/removal, offline seed artwork import, and operational storage guidance. The generated frontend cover remains the fallback.

S3 implementation, direct browser-to-storage uploads, arbitrary URL imports, cropping tools, galleries, background image jobs, and historical order-cover snapshots are out of scope. No external image service is called during requests or seeding.

## Persistence and compatibility

Add nullable `cover_key`, `cover_width`, `cover_height`, and non-null `cover_revision` defaulting to zero to books in both database schemas. Cover metadata is either entirely null or a complete key/positive-dimension tuple; revision is a nonnegative integer. The stored format is always WebP. Generate and review additive migrations for both providers; preserve all existing data. Existing books start without covers and retain the frontend fallback.

Keys have the server-generated form `covers/<uuid>.webp`. Never persist an absolute filesystem path, public host URL, original filename, or image bytes in the database. Derive public URLs at response time. Every successful replacement or removal increments revision atomically. Revisions also prevent seeding from restoring a cover deliberately removed by staff.

GraphQL adds `type BookCover { url: String!, width: Int!, height: Int! }`, nullable `cover: BookCover` to `Book` and `AdminBook`, and `coverRevision: Int!` to `AdminBook`. Add nullable `cover` to the live book object used in account-cart responses; inspect its existing type and reuse `Book` where it already applies. Cart requests and persisted guest-cart envelopes do not acquire image fields. Old clients remain compatible. Generate resolver and frontend types rather than editing generated files.

For guest-bag display add `type BookCoverLookup { id: ID!, cover: BookCover }` and public query `bookCovers(ids: [ID!]!): [BookCoverLookup!]!`. Accept up to 50 positive book IDs, deduplicate results, and return only existing active books; absent/archived IDs are omitted. Empty input returns an empty list. Reject malformed IDs or more than 50 input IDs with `BAD_USER_INPUT`. Use one bounded database lookup rather than one query per ID. Return metadata only, with no stock mutation or cart persistence changes.

## HTTP contract

The following endpoints are implemented. Book IDs use the existing positive-ID validation.

- `PUT /api/books/:id/cover`: raw file bytes, with Content-Type `image/jpeg`, `image/png`, or `image/webp`, and `If-Match: "<coverRevision>"`. No multipart, JSON/base64, or caller-supplied storage key.
- `DELETE /api/books/:id/cover`: empty body with the same revision precondition. Removing an already absent cover at the current revision returns the current state without incrementing it or logging a change.
- Successful writes return HTTP 200 and `{ bookId: string, cover: { url: string, width: number, height: number } | null, coverRevision: number }` with `Cache-Control: no-store`.
- Missing/invalid precondition: 400 `INVALID_COVER_REVISION`; stale revision: 409 `COVER_CONFLICT`; missing book: 404 `BOOK_NOT_FOUND`. Reject unauthorized callers before revealing book existence or processing image bytes.
- JSON failures have `{ error: { code: string, message: string } }`. Other outcomes: 401 `UNAUTHENTICATED`, 403 `FORBIDDEN`, 413 `COVER_TOO_LARGE`, 415 `UNSUPPORTED_COVER_TYPE`, 422 `INVALID_COVER_IMAGE`, and 503 `COVER_UNAVAILABLE`. Do not expose internal paths or decoder errors.
- `GET`/`HEAD /media/covers/:filename`: anonymous public delivery of normalized WebP files only. Accept only UUID `.webp` filenames; reject traversal and malformed names, disable directory listing and dotfiles, and return 404 for missing files. Successful images use `Content-Type: image/webp`, `X-Content-Type-Options: nosniff`, and `Cache-Control: public, max-age=31536000, immutable`. A replacement always gets a new key/URL.

## Authentication and validation

Reuse the existing verified cookie-session lookup and current stored `MANAGE_CATALOG` permission. Staff and Admin qualify; guests, unverified accounts, Customers, and revoked roles do not. Perform authorization before reading the bounded raw upload body; recheck the current permission at the committing operation. Keep Better Auth's handler before its existing parsers. Require the configured storefront Origin for PUT/DELETE and credentialed CORS; reject absent or foreign Origin on browser write endpoints. Allow only the required methods and Content-Type/If-Match headers. Seed CLI uses an internal service path, not these browser endpoints.

Maximum input is **5 MiB (5,242,880 bytes)**. Inspect actual decoded format and require it to match the accepted declared type. Reject empty, corrupt, animated/multi-frame, SVG, GIF, and other unsupported images. PNG input also receives bounded chunk-boundary `acTL` detection before normalization so APNG is rejected even when decoder metadata does not expose page count. Limit decoded input to **20,000,000 pixels** and each edge to **10,000 pixels**. Apply orientation, strip metadata, preserve artwork aspect ratio, and encode a single WebP at quality **85**, fitting within **800 × 1200 pixels** without enlargement or cropping. Do not reject legitimate landscape artwork; the frontend contains it in a portrait frame. Bound active decodes to **two per API process**; reject additional uploads with 503 rather than creating an unbounded queue. The delivered decoder is Sharp 0.35.5.

## Storage boundary and failure handling

The internal `CoverStorage` contract is `put(key: string, bytes: Uint8Array): Promise<void>`, `remove(key: string): Promise<void>`, and `publicUrl(key: string): string`. `put` publishes the complete immutable object atomically; `remove` is idempotent for missing keys. Only the local adapter is implemented in this feature. The cover service receives it by injection and domain logic does not import disk APIs.

Configuration is `COVER_STORAGE_DRIVER=local` (unsupported drivers are rejected), `COVER_UPLOAD_DIR=./data/uploads` (resolved against API process cwd), and `COVER_PUBLIC_BASE_URL`, the absolute externally reachable base corresponding to `/media/`. Outside production the public base defaults to `http://localhost:${PORT}/media/`; production requires an explicit HTTPS base. Its URL scheme is HTTP or HTTPS and it must not contain credentials, query, or fragment. A key `covers/x.webp` resolves below that base. Tests inject temporary roots and explicit public bases. Startup verifies the managed root is writable.

The local adapter serves only the `covers` child directory, writes temporary files outside the public directory, and renames on the same filesystem. Path resolution must remain within the configured root, independent of input filenames. Ignore runtime uploads in Git; never write uploads into `src`, `dist`, or the frontend public directory.

Normalize and save a new object first; then atomically compare-and-set the expected revision and record the activity event in the database transaction. Do not hold a database transaction during decoding or filesystem writes. On conflict/database failure, leave the old reference intact and best-effort remove the new object. Cleanup failure must not mask the original failure. Old replaced/removed objects remain available until explicit cleanup, avoiding a broken image in an already-open page. Archiving a book retains its cover; existing archive visibility rules remain unchanged.

The `covers:cleanup` operator command is dry-run by default, with explicit `--apply`. It removes only unreferenced, valid managed keys older than **24 hours**, never seed source files. Both dry-run and apply require API writers and seed commands stopped; document this maintenance window. Filesystem/database backups form one recoverable set. No automatic destructive cleanup on startup.

## Activity

Reuse `BOOK_UPDATED` with a new `COVER` changed-field value. Before/after values are nullable managed storage keys, never public URLs or local absolute paths. Preserve the actual Staff/Admin actor; extend the actor source contract to `HTTP` for these REST writes and update validation/mapping tests. Change and audit record commit together. Seed imports do not impersonate staff or add customer-visible history. The frontend labels the field “Cover” and renders keys as plain text, never links or image markup.

## Seed artwork

The delivered source directory is `seed-assets/covers/`, with a manifest mapping stable seed slugs to exact sample title/author and artwork filenames. Entries record provenance and usage notes. The 12 original demo designs are demo interpretations rather than publisher editions: ten ImageGen covers and two original vector covers. Their visible text was visually reviewed for readability; the artwork is not represented as deterministically recomposed typography.

All 12 `sampleBooks` entries have finished 800 × 1200 original demo covers with readable title/author text and varied palettes. The collection contains no licensed photography, scraping, remote placeholder URLs, or live downloads during seed runs.

Run `bun run seed:covers` after existing `bun run db:seed` when an explicit sample-cover import is intended. It uses the same image normalization/storage path, matches each manifest entry to exactly one title/author pair, and reports/skips missing or ambiguous matches rather than guessing numeric IDs. It fills only `cover_key IS NULL AND cover_revision = 0`, so concurrent staff work wins and reruns neither duplicate skipped files nor reset catalog data. Production sample seeding remains disabled, server startup writes no images, and the full manifest was exercised only through the isolated CLI fixture.

## Later S3 cutover

Implement an adapter satisfying `CoverStorage` later. With writers stopped, copy managed objects preserving keys and verify checksums/counts and all referenced keys, then switch driver/public base and restart. Keep the local copy for rollback. Changing configuration alone does not migrate images. The frontend contract remains `cover.url`; no per-book URL rewrite is required. Direct uploads, signed/private delivery, mixed-provider reads, and multi-instance shared local storage are separate future work.

## Acceptance and verification

- [x] Existing SQLite/PostgreSQL catalogs migrate without data loss and expose nullable covers.
- [x] Authorized staff upload/replace/remove; stale edits conflict; authorization precedes body processing and lookup disclosure.
- [x] Limits, format spoofing, animation, orientation, decode concurrency and filesystem containment behave as specified.
- [x] Failed normalization/storage/database/audit writes preserve the previous cover; abandoned objects can be safely cleaned up.
- [x] Public media, immutable cache headers and new-key replacement work after API restart on a persistent disk.
- [x] Explicit seed import works offline, preserves staff changes/removals, and covers the complete sample manifest.
- [x] Fake alternate storage verifies the service consumes the interface and returns adapter URLs without disk assumptions.
- [x] Activity, focused integration tests, migrations and SQLite/PostgreSQL parity pass; cross-repository upload/display browser journeys pass.

Before delivery run backend codegen, tests, lint, build, PostgreSQL tests, and coordinated browser checks. Document persistent volume setup, writable-root ownership, proxy body limits at least 5 MiB plus HTTP overhead, backup/restore, cleanup and future cutover. Rollback application binaries while preserving additive columns and disk assets; do not drop data to revert this feature.

## Delivery reconciliation

The local adapter, injected `CoverStorage` boundary, Sharp WebP normalization, raw authenticated PUT/DELETE routes, immutable `/media/covers` delivery, additive SQLite/PostgreSQL migrations, GraphQL cover metadata and bounded guest lookup are present. Each committed replace/remove records `BOOK_UPDATED` with changed field `COVER` and an HTTP actor; the repository serializes actor lookup with the write so concurrent role demotion cannot authorize a stale actor.

`COVER_STORAGE_DRIVER` currently supports only `local`. `COVER_UPLOAD_DIR` defaults to `./data/uploads`. Outside production, `COVER_PUBLIC_BASE_URL` defaults to `http://localhost:${PORT}/media/`; production requires an explicit HTTPS media base. Runtime uploads remain unseeded: `seed:covers` was exercised only with an isolated fixture, where it imported 12 covers, skipped all 12 on rerun, and cleanup found no orphaned objects. The committed manifest contains the 12 original demo covers and provenance; ten are ImageGen artwork and two are original vector artwork. Text readability was visually reviewed rather than reconstructed by deterministic composition.

Run `bun run covers:cleanup --writers-stopped` to report eligible orphaned managed objects. Add `--apply` only after the same stopped-writer maintenance window; deletion is otherwise disabled. Preserve the database and upload root in one backup/restore set. An S3 adapter is future work: stop writers, copy managed keys, verify object checksums/counts and every database reference, switch the driver/public base, restart, and retain the local copy for rollback. Configuration alone does not migrate objects.

Confirmed backend evidence: the final SQLite suite passed **319**, skipped **2**, across **321** tests in **56** files; one new skip is a PostgreSQL-only race that passed in the PostgreSQL suite, and one skip pre-existed. The final PostgreSQL suite passed **41/41**. Backend lint and build passed. The frontend unit suite passed **276/276** across **51** files; frontend lint and build passed (with the existing bundle-size warning). The full SQLite browser suite passed **73/73**. The full PostgreSQL browser run passed **72/73**: its single failure was a pre-existing archived-cart test setup race, corrected by waiting for the visible add-to-bag confirmation before archive; the focused PostgreSQL rerun then passed **1/1**. The main cover browser journey passed at actual 200% zoom, including cross-port CORS, conflict retry, focus restoration, and unsaved-detail preservation. Compiled-application smoke checks passed for SQLite and PostgreSQL.
