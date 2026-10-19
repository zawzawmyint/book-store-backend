import { afterEach, beforeEach, expect, it } from 'vitest'
import request from 'supertest'
import sharp from 'sharp'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabase } from '../src/database/connection.js'
import { seedBooks } from '../src/database/seed.js'
import { createApp } from '../src/app.js'
import { verifiedFixtureRequest, capturedFixtureSender } from './verified-auth-fixture.js'
import { animatedPng } from './fixtures/covers/animated-png.js'

const options = {
  frontendOrigin: 'http://localhost:5173',
  authBaseURL: 'http://localhost:5173',
  authSecret: 'cover-tests-secret-at-least-thirty-two-characters',
  emailSender: capturedFixtureSender,
}
let db: ReturnType<typeof createDatabase>
let app: Awaited<ReturnType<typeof createApp>>
let root: string
let cookies: string[]
let userId: string
let image: Buffer
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'book-covers-'))
  db = createDatabase(join(root, 'catalog.sqlite'))
  seedBooks(db)
  app = await createApp(db, {
    ...options,
    covers: { directory: root, publicBaseUrl: 'http://localhost:4000/media/' },
  })
  const res = await verifiedFixtureRequest(app, db, options)
    .post('/api/auth/sign-up/email')
    .set('Origin', options.frontendOrigin)
    .send({ name: 'Staff', email: 'staff@example.com', password: 'correct-horse-battery-staple' })
  expect(res.status).toBe(200)
  cookies = res.headers['set-cookie'] as string[]
  userId = res.body.user.id
  db.prepare("INSERT INTO user_roles (user_id, role) VALUES (?, 'STAFF')").run(userId)
  image = await sharp({ create: { width: 120, height: 180, channels: 3, background: '#275553' } })
    .png()
    .toBuffer()
})
afterEach(async () => {
  await app?.locals.close()
  db?.close()
  await rm(root, { recursive: true, force: true })
})
function put(revision = 0, bytes = image, type = 'image/png') {
  return request(app)
    .put('/api/books/1/cover')
    .set('Cookie', cookies)
    .set('Origin', options.frontendOrigin)
    .set('If-Match', `"${revision}"`)
    .set('Content-Type', type)
    .send(bytes)
}
function remove(revision: number) {
  return request(app)
    .delete('/api/books/1/cover')
    .set('Cookie', cookies)
    .set('Origin', options.frontendOrigin)
    .set('If-Match', `"${revision}"`)
}
it('uploads, publicly serves, replaces and removes covers with audited revisions', async () => {
  const uploaded = await put()
  expect(uploaded.status).toBe(200)
  expect(uploaded.body).toMatchObject({
    bookId: '1',
    coverRevision: 1,
    cover: { width: 120, height: 180 },
  })
  const path = new URL(uploaded.body.cover.url).pathname
  const media = await request(app).get(path)
  expect(media.status).toBe(200)
  expect(media.headers['content-type']).toContain('image/webp')
  expect(media.headers['cache-control']).toContain('immutable')
  expect((await request(app).head(path)).status).toBe(200)
  expect((await put()).status).toBe(409)
  const replaced = await put(1)
  expect(replaced.body.cover.url).not.toBe(uploaded.body.cover.url)
  expect((await remove(1)).status).toBe(409)
  expect((await remove(2)).body).toMatchObject({ cover: null, coverRevision: 3 })
  expect((await remove(3)).body.coverRevision).toBe(3)
  expect((await request(app).get(path)).status).toBe(200)
  const audit = db
    .prepare("SELECT source, changes_json FROM activity_events WHERE action = 'BOOK_UPDATED'")
    .all() as { source: string; changes_json: string }[]
  expect(audit).toHaveLength(3)
  expect(audit[0].source).toBe('HTTP')
  expect(JSON.parse(audit[0].changes_json)[0].field).toBe('COVER')
})
it('rejects unauthenticated, foreign-origin and revoked-role writes without revealing book existence', async () => {
  expect(
    (
      await request(app)
        .put('/api/books/999/cover')
        .set('Origin', options.frontendOrigin)
        .set('Content-Type', 'image/png')
        .send(image)
    ).status,
  ).toBe(401)
  expect(
    (
      await request(app)
        .put('/api/books/1/cover')
        .set('Cookie', cookies)
        .set('Origin', 'https://foreign.test')
        .send(image)
    ).status,
  ).toBe(403)
  db.prepare("UPDATE user_roles SET role = 'CUSTOMER' WHERE user_id = ?").run(userId)
  expect((await put()).status).toBe(403)
})
it('rejects spoofed, corrupt, unsupported, oversized and invalid-precondition uploads while preserving current cover', async () => {
  expect((await put()).status).toBe(200)
  expect((await put(1, image, 'image/jpeg')).status).toBe(422)
  expect((await put(1, Buffer.from('bad'), 'image/png')).status).toBe(422)
  expect((await put(1, Buffer.from('<svg/>'), 'image/svg+xml')).status).toBe(415)
  expect((await put(1, Buffer.alloc(5 * 1024 * 1024 + 1))).status).toBe(413)
  expect(
    (
      await request(app)
        .put('/api/books/1/cover')
        .set('Cookie', cookies)
        .set('Origin', options.frontendOrigin)
        .set('Content-Type', 'image/png')
        .send(image)
    ).status,
  ).toBe(400)
  expect(
    (
      db.prepare('SELECT cover_revision FROM books WHERE id = 1').get() as {
        cover_revision: number
      }
    ).cover_revision,
  ).toBe(1)
})
it('rejects animated PNG without silently saving its first frame', async () => {
  const response = await put(0, animatedPng, 'image/png')
  expect(response.status).toBe(422)
  expect(response.body.error.code).toBe('INVALID_COVER_IMAGE')
  expect(db.prepare('SELECT cover_key, cover_revision FROM books WHERE id = 1').get()).toEqual({
    cover_key: null,
    cover_revision: 0,
  })
})
it('persists the file and cover reference across an API and database restart', async () => {
  const uploaded = await put()
  expect(uploaded.status).toBe(200)
  await app.locals.close()
  db.close()
  db = createDatabase(join(root, 'catalog.sqlite'))
  app = await createApp(db, {
    ...options,
    covers: { directory: root, publicBaseUrl: 'http://localhost:4000/media/' },
  })
  expect((await request(app).get(new URL(uploaded.body.cover.url).pathname)).status).toBe(200)
  const book = await request(app)
    .post('/graphql')
    .send({ query: '{ book(id:"1") { cover { url } } }' })
  expect(book.body.data.book.cover.url).toBe(uploaded.body.cover.url)
})
it('projects nullable covers and a bounded public lookup without archived books', async () => {
  expect((await put()).status).toBe(200)
  const gql = (query: string) => request(app).post('/graphql').send({ query })
  const result = await gql(
    '{ book(id:"1") { cover { url width height } } bookCovers(ids:["1","1","999"]) { id cover { width } } }',
  )
  expect(result.body.errors).toBeUndefined()
  expect(result.body.data.bookCovers).toHaveLength(1)
  db.prepare('UPDATE books SET archived = 1 WHERE id = 1').run()
  expect((await gql('{ bookCovers(ids:["1"]) { id } }')).body.data.bookCovers).toEqual([])
  expect((await gql('{ bookCovers(ids:["bad"]) { id } }')).body.errors[0].extensions.code).toBe(
    'BAD_USER_INPUT',
  )
})
