import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { createDatabase } from '../src/database/connection.js'
import * as notificationStreams from '../src/modules/notifications/notification.sse.js'
import { once } from 'node:events'

const options = {
  frontendOrigin: 'http://localhost:5173',
  authBaseURL: 'http://localhost:5173',
  authSecret: 'operational-test-secret-at-least-thirty-two-characters',
}
let db: ReturnType<typeof createDatabase>
let app: Awaited<ReturnType<typeof createApp>>
let lines: string[]
it.each(['/api/notifications/stream', '/api/notifications/stream/', '/API/notifications/stream'])(
  'silences successful %s disconnects while preserving setup error severity',
  async (streamPath) => {
    await app.locals.close()
    const factory = notificationStreams.createNotificationStreams
    let streams!: ReturnType<typeof factory>
    let status: 401 | 403 | undefined
    let ready = true
    vi.spyOn(notificationStreams, 'createNotificationStreams').mockImplementation(
      (config, live, streamOptions) => {
        streams = factory(
          { ...config, enabled: true, liveEnabled: true },
          {
            ...live,
            get ready() {
              return ready
            },
          },
          {
            ...streamOptions,
            limits: { perUser: 1, total: 1 },
            async authorize() {
              return status ? { status } : { userId: 'private-recipient' }
            },
          },
        )
        return streams
      },
    )
    app = await createApp(db, options)
    const server = app.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const controller = new AbortController()
    try {
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}${streamPath}?scope=STOREFRONT`
      const response = await fetch(url, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      })
      expect(response.status).toBe(200)
      expect((await fetch(url)).status).toBe(429)
      status = 401
      expect((await fetch(url)).status).toBe(401)
      status = 403
      expect((await fetch(url)).status).toBe(403)
      ready = false
      expect((await fetch(url)).status).toBe(503)
      await response.body!.cancel()
      await vi.waitFor(() => expect(streams.size).toBe(0))
      const events = lines.map((line) => JSON.parse(line))
      expect(
        events.filter((event) => event.event === 'http.aborted' || event.route === 'unmatched'),
      ).toEqual([])
      expect(
        events
          .filter((event) => event.event === 'http.completed')
          .map((event) => [event.route, event.statusCode, event.level]),
      ).toEqual([
        ['/api/notifications/stream', 429, 'warn'],
        ['/api/notifications/stream', 401, 'warn'],
        ['/api/notifications/stream', 403, 'warn'],
        ['/api/notifications/stream', 503, 'error'],
      ])
    } finally {
      controller.abort()
      streams.close()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  },
)
it('keeps unsupported JSON charset errors as client errors without logging body contents', async () => {
  const response = await request(app)
    .post('/graphql')
    .set('Content-Type', 'application/json; charset=iso-8859-1')
    .send('{"password":"charset-secret"}')
  expect(response.status).toBe(415)
  expect(lines.map((line) => JSON.parse(line))).toContainEqual(
    expect.objectContaining({
      event: 'http.failed',
      level: 'warn',
      statusCode: 415,
      errorCode: 'BAD_REQUEST',
    }),
  )
  expect(lines.join('')).not.toContain('charset-secret')
})
beforeEach(async () => {
  lines = []
  for (const method of ['log', 'warn', 'error'] as const)
    vi.spyOn(console, method).mockImplementation((line) => lines.push(String(line)))
  db = createDatabase(':memory:')
  app = await createApp(db, options)
})
afterEach(async () => {
  await app.locals.close()
  if (db.open) db.close()
  vi.restoreAllMocks()
})

it('reports database readiness without caching or logging healthy polling', async () => {
  const response = await request(app).get('/ready')
  expect(response.status).toBe(200)
  expect(response.body).toEqual({ status: 'ready' })
  expect(response.headers['cache-control']).toBe('no-store')
  expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  await request(app).get('/health')
  expect(lines).toEqual([])
})

it('reports database loss without making liveness fail or exposing details', async () => {
  db.close()
  const response = await request(app).get('/ready')
  expect(response.status).toBe(503)
  expect(response.body).toEqual({ status: 'unavailable' })
  expect((await request(app).get('/health')).body).toEqual({ status: 'ok' })
  await request(app).get('/ready')
  const events = lines.map((line) => JSON.parse(line))
  expect(events.filter((event) => event.event === 'readiness.unavailable')).toHaveLength(1)
})

it('correlates successful and HTTP-200 failed GraphQL operations with fresh IDs', async () => {
  const good = await request(app)
    .post('/graphql')
    .set('X-Request-ID', 'caller-secret')
    .send({ query: 'query Browse { books { total } }' })
  const bad = await request(app)
    .post('/graphql')
    .send({ query: 'query Invalid { books(limit: 100) { total } }' })
  expect(good.status).toBe(200)
  expect(bad.status).toBe(200)
  expect(bad.body.errors[0].extensions.code).toBe('BAD_USER_INPUT')
  expect(good.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  expect(bad.headers['x-request-id']).not.toBe(good.headers['x-request-id'])
  const events = lines.map((line) => JSON.parse(line))
  expect(events).toContainEqual(
    expect.objectContaining({
      event: 'graphql.completed',
      level: 'info',
      operationName: 'Browse',
      requestId: good.headers['x-request-id'],
    }),
  )
  expect(events).toContainEqual(
    expect.objectContaining({
      event: 'graphql.failed',
      level: 'warn',
      errorCode: 'BAD_USER_INPUT',
      requestId: bad.headers['x-request-id'],
    }),
  )
  expect(lines.join('')).not.toContain('caller-secret')
})

it('masks unexpected database failures and never logs request secrets or raw errors', async () => {
  db.close()
  const response = await request(app)
    .post('/graphql?token=query-secret')
    .set('Authorization', 'Bearer header-secret')
    .send({
      query: 'query Broken($search: String) { books(search: $search) { total } }',
      variables: { search: 'private-address-secret' },
    })
  expect(response.body.errors[0].extensions.code).toBe('INTERNAL_SERVER_ERROR')
  const events = lines.map((line) => JSON.parse(line))
  expect(events).toContainEqual(
    expect.objectContaining({
      event: 'graphql.failed',
      level: 'error',
      errorCode: 'INTERNAL_SERVER_ERROR',
      requestId: response.headers['x-request-id'],
    }),
  )
  for (const secret of ['query-secret', 'header-secret', 'private-address-secret', 'not open'])
    expect(lines.join('')).not.toContain(secret)
})

it('preserves responses if console output fails and labels unknown routes safely', async () => {
  vi.mocked(console.log).mockImplementation(() => {
    throw new Error('sink unavailable')
  })
  expect((await request(app).post('/graphql').send({ query: '{ books { total } }' })).status).toBe(
    200,
  )
  vi.mocked(console.log).mockImplementation((line) => lines.push(String(line)))
  const missing = await request(app).get('/private-token-secret?email=reader@example.com')
  expect(missing.status).toBe(404)
  expect(missing.headers['x-request-id']).toBeTruthy()
  expect(lines.map((line) => JSON.parse(line))).toContainEqual(
    expect.objectContaining({
      event: 'http.completed',
      route: 'unmatched',
      statusCode: 404,
    }),
  )
  expect(lines.join('')).not.toContain('private-token-secret')
})

it('isolates concurrent request IDs and safely handles malformed JSON', async () => {
  const responses = await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      request(app)
        .post('/graphql')
        .send({ query: `query Browse${index} { books { total } }` }),
    ),
  )
  expect(new Set(responses.map((response) => response.headers['x-request-id'])).size).toBe(4)
  const events = lines.map((line) => JSON.parse(line))
  responses.forEach((response, index) => {
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'graphql.completed',
        operationName: `Browse${index}`,
        requestId: response.headers['x-request-id'],
      }),
    )
  })
  const invalid = await request(app)
    .post('/graphql')
    .set('Content-Type', 'application/json')
    .send('{"password":"malformed-secret"')
  expect(invalid.status).toBe(400)
  expect(invalid.body).toEqual({ error: 'Invalid request' })
  expect(invalid.headers['x-request-id']).toBeTruthy()
  expect(lines.join('')).not.toContain('malformed-secret')
})

it('classifies notification setup failures without exposing query or cookie values', async () => {
  const response = await request(app)
    .get('/api/notifications/stream?scope=private-query-secret')
    .set('Cookie', 'secret-cookie')
  expect(response.status).toBe(404)
  expect(lines.map((line) => JSON.parse(line))).toContainEqual(
    expect.objectContaining({
      event: 'http.completed',
      route: '/api/notifications/stream',
      statusCode: 404,
      level: 'warn',
    }),
  )
  expect(lines.join('')).not.toMatch(/private-query-secret|secret-cookie/)
})
