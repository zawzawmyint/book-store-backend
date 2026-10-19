import { afterEach, expect, it } from 'vitest'
import sharp from 'sharp'
import { mkdtemp, rm, writeFile, readFile, utimes, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createDatabase } from '../src/database/connection.js'
import { normalizeStore } from '../src/database/persistence.js'
import { seedBooks } from '../src/database/seed.js'
import { createLocalCoverStorage } from '../src/modules/covers/local-cover.storage.js'
import { normalizeCover } from '../src/modules/covers/cover.image.js'
import { seedCovers } from '../src/modules/covers/cover-seed.js'
import { cleanupCovers } from '../src/modules/covers/cover-cleanup.js'
import { createCoverService } from '../src/modules/covers/cover.service.js'
import { createCoverRepository } from '../src/modules/covers/cover.repository.js'
import { sampleBooks } from '../src/database/seed.js'
import { loadCoverConfig } from '../src/modules/covers/cover.config.js'
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cover-operations-'))
  roots.push(root)
  const storage = await createLocalCoverStorage(root, 'https://media.example.test/media/')
  const bytes = await sharp({
    create: { width: 120, height: 180, channels: 3, background: '#245354' },
  })
    .webp()
    .toBuffer()
  return { root, storage, bytes }
}
it('imports local seed assets once and preserves staff removals and replacements', async () => {
  const { root, storage, bytes } = await fixture()
  const db = createDatabase(':memory:')
  seedBooks(db)
  try {
    const store = normalizeStore(db)
    await writeFile(join(root, 'gatsby.webp'), bytes)
    const entries = [
      {
        slug: 'gatsby',
        title: 'The Great Gatsby',
        author: 'F. Scott Fitzgerald',
        filename: 'gatsby.webp',
      },
    ]
    expect((await seedCovers(store, storage, root, entries)).imported).toEqual(['gatsby'])
    expect((await seedCovers(store, storage, root, entries)).skipped).toEqual(['gatsby'])
    await store.setBookCover(1, 1, { coverKey: null, coverWidth: null, coverHeight: null })
    expect((await seedCovers(store, storage, root, entries)).imported).toEqual([])
    expect((await store.book(1))?.coverKey).toBeNull()
  } finally {
    db.close()
  }
})
it('cleanup defaults to dry run and deletes only old unreferenced managed images', async () => {
  const { root, storage, bytes } = await fixture()
  const key = `covers/${randomUUID()}.webp`,
    current = `covers/${randomUUID()}.webp`,
    young = `covers/${randomUUID()}.webp`
  for (const k of [key, current, young]) await storage.put(k, bytes)
  const old = new Date(Date.now() - 25 * 3600_000)
  for (const k of [key, current]) await utimes(join(root, k), old, old)
  expect(await cleanupCovers(root, new Set([current]))).toEqual([key])
  expect((await readFile(join(root, key))).length).toBeGreaterThan(0)
  expect(await cleanupCovers(root, new Set([current]), true)).toEqual([key])
  await expect(readFile(join(root, key))).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await readFile(join(root, current))).length).toBeGreaterThan(0)
})
it('normalizes orientation, strips metadata, preserves landscape and does not enlarge', async () => {
  const input = await sharp({
    create: { width: 100, height: 200, channels: 3, background: '#abc' },
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer()
  const normalized = await normalizeCover(input, 'image/jpeg')
  expect([normalized.width, normalized.height]).toEqual([200, 100])
  const metadata = await sharp(normalized.bytes).metadata()
  expect(metadata.format).toBe('webp')
  expect(metadata.exif).toBeUndefined()
  const large = await sharp({
    create: { width: 1200, height: 1800, channels: 3, background: '#abc' },
  })
    .png()
    .toBuffer()
  expect(await normalizeCover(large, 'image/png')).toMatchObject({ width: 800, height: 1200 })
})
it('rejects traversal keys and cleans a failed database save without changing the current cover', async () => {
  const { storage, bytes } = await fixture()
  await expect(storage.put('../escape.webp', bytes)).rejects.toThrow('Invalid managed cover key')
  const db = createDatabase(':memory:')
  seedBooks(db)
  try {
    const repository = createCoverRepository(db)
    const service = createCoverService(repository, storage)
    await service.upload(1, 0, bytes, 'image/webp')
    const before = await repository.get(1)
    const failing = createCoverService(
      {
        ...repository,
        save: async () => {
          throw new Error('database failed')
        },
      },
      storage,
    )
    await expect(failing.upload(1, 1, bytes, 'image/webp')).rejects.toThrow('database failed')
    expect(await repository.get(1)).toEqual(before)
  } finally {
    db.close()
  }
})
it('bounds concurrent decodes, rejects animated images, oversized dimensions and corrupt pixel data', async () => {
  const { bytes } = await fixture()
  const concurrent = await Promise.allSettled([
    normalizeCover(bytes, 'image/webp'),
    normalizeCover(bytes, 'image/webp'),
    normalizeCover(bytes, 'image/webp'),
  ])
  expect(concurrent.filter((result) => result.status === 'fulfilled')).toHaveLength(2)
  expect(concurrent.find((result) => result.status === 'rejected')).toMatchObject({
    reason: { status: 503 },
  })
  const animated = await sharp(Buffer.concat([Buffer.alloc(12, 0), Buffer.alloc(12, 255)]), {
    raw: { width: 2, height: 4, channels: 3, pageHeight: 2 },
  })
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer()
  expect((await sharp(animated).metadata()).pages).toBe(2)
  await expect(normalizeCover(animated, 'image/webp')).rejects.toMatchObject({
    code: 'INVALID_COVER_IMAGE',
  })
  const tooWide = await sharp({
    create: { width: 10001, height: 1, channels: 3, background: '#abc' },
  })
    .png()
    .toBuffer()
  await expect(normalizeCover(tooWide, 'image/png')).rejects.toMatchObject({
    code: 'INVALID_COVER_IMAGE',
  })
  await expect(normalizeCover(bytes.subarray(0, 25), 'image/webp')).rejects.toMatchObject({
    code: 'INVALID_COVER_IMAGE',
  })
  expect((await normalizeCover(bytes, 'image/webp')).width).toBe(120)
})
it('rejects permission loss at commit, rolls back audit failure, and cleans abandoned new objects', async () => {
  const { root, storage, bytes } = await fixture()
  const db = createDatabase(':memory:')
  seedBooks(db)
  try {
    const store = normalizeStore(db),
      repository = createCoverRepository(store)
    const service = createCoverService(repository, storage)
    const actor = {
      source: 'HTTP' as const,
      userId: 'missing-user',
      name: 'Former staff',
      role: 'STAFF' as const,
    }
    await expect(service.upload(1, 0, bytes, 'image/webp', actor)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(await readdir(join(root, 'covers'))).toEqual([])
    expect((await repository.get(1))?.coverRevision).toBe(0)
    db.exec(
      "INSERT INTO user(id,name,email,email_verified) VALUES('staff','Staff','staff@local.test',1); INSERT INTO user_roles(user_id,role) VALUES('staff','STAFF')",
    )
    db.exec(
      "CREATE TRIGGER reject_cover_audit BEFORE INSERT ON activity_events BEGIN SELECT RAISE(ABORT,'audit unavailable'); END",
    )
    await expect(
      service.upload(1, 0, bytes, 'image/webp', { ...actor, userId: 'staff' }),
    ).rejects.toThrow()
    expect((await repository.get(1))?.coverKey).toBeNull()
    expect(await readdir(join(root, 'covers'))).toEqual([])
  } finally {
    db.close()
  }
})
it('imports every bundled seed offline through an alternate storage implementation', async () => {
  const db = createDatabase(':memory:')
  seedBooks(db)
  const objects = new Map<string, Uint8Array>()
  const storage = {
    put: async (key: string, bytes: Uint8Array) => {
      objects.set(key, bytes)
    },
    remove: async (key: string) => {
      objects.delete(key)
    },
    publicUrl: (key: string) => `https://cdn.example.test/${key}`,
  }
  try {
    const entries = JSON.parse(
      await readFile(new URL('../seed-assets/covers/manifest.json', import.meta.url), 'utf8'),
    )
    expect(entries).toHaveLength(sampleBooks.length)
    const result = await seedCovers(
      normalizeStore(db),
      storage,
      new URL('../seed-assets/covers/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
      entries,
    )
    expect(result.imported).toHaveLength(sampleBooks.length)
    expect(objects.size).toBe(sampleBooks.length)
    for (const bytes of objects.values())
      expect(await sharp(bytes).metadata()).toMatchObject({
        format: 'webp',
        width: 800,
        height: 1200,
      })
    expect((await seedCovers(normalizeStore(db), storage, '.', entries)).skipped).toHaveLength(
      sampleBooks.length,
    )
  } finally {
    db.close()
  }
})
it('validates storage configuration and requires a secure production public base', () => {
  expect(loadCoverConfig({ NODE_ENV: 'development', PORT: '4100' })).toMatchObject({
    publicBaseUrl: 'http://localhost:4100/media/',
  })
  expect(() => loadCoverConfig({ COVER_STORAGE_DRIVER: 's3' })).toThrow()
  expect(() => loadCoverConfig({ NODE_ENV: 'production' })).toThrow()
  expect(() =>
    loadCoverConfig({
      NODE_ENV: 'production',
      COVER_PUBLIC_BASE_URL: 'http://example.test/media/',
    }),
  ).toThrow()
  expect(() =>
    loadCoverConfig({ COVER_PUBLIC_BASE_URL: 'https://user:secret@example.test/media/' }),
  ).toThrow()
})
