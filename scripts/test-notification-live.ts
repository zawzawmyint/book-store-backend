// Two real API processes, one disposable SQLite database, dedicated loopback Redis channel.
import assert from 'node:assert/strict'
import { spawn, fork, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Redis } from 'ioredis'
import { createDatabase } from '../src/database/connection.js'
import { seedBooks } from '../src/database/seed.js'

const binary = process.env.NOTIFICATION_TEST_REDIS_BINARY ?? process.env.EMAIL_TEST_REDIS_BINARY
let redisUrl = process.env.NOTIFICATION_TEST_REDIS_URL
if (!redisUrl && !binary)
  throw new Error(
    'Set NOTIFICATION_TEST_REDIS_BINARY (preferred) or an isolated NOTIFICATION_TEST_REDIS_URL',
  )
if (redisUrl && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(redisUrl).hostname))
  throw new Error('Notification live tests refuse non-loopback Redis')
const directory = await mkdtemp(join(tmpdir(), 'book-store-notification-live-'))
const databasePath = join(directory, 'notifications.sqlite')
const db = createDatabase(databasePath)
seedBooks(db)
const prefix = `notification-test-${randomUUID()}`
const children: ChildProcess[] = []
let redisProcess: ChildProcess | undefined
let probe: Redis | undefined
const streams: AbortController[] = []
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check: () => boolean | Promise<boolean>, label: string, timeout = 10000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await check()) return
    await delay(50)
  }
  throw new Error(`Timed out waiting for ${label}`)
}
async function freePort() {
  const server = createServer()
  await new Promise<void>((accept, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', accept)
  })
  const address = server.address()
  assert(address && typeof address !== 'string')
  await new Promise<void>((accept) => server.close(() => accept()))
  return address.port
}
async function startRedis(port: number) {
  redisProcess = spawn(
    binary!,
    [
      '--bind',
      '127.0.0.1',
      '--port',
      String(port),
      '--dir',
      directory,
      '--save',
      '',
      '--appendonly',
      'no',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  )
  let startupOutput = ''
  const capture = (chunk: Buffer) => {
    startupOutput = (startupOutput + chunk.toString()).slice(-4096)
  }
  redisProcess.stdout?.on('data', capture)
  redisProcess.stderr?.on('data', capture)
  let error = false
  redisProcess.once('error', () => {
    error = true
  })
  try {
    await until(async () => {
      if (error || redisProcess!.exitCode !== null) throw Error('Isolated Redis failed to start')
      try {
        return (await probe!.ping()) === 'PONG'
      } catch {
        return false
      }
    }, 'Redis startup')
  } catch (error) {
    console.error(startupOutput)
    throw error
  }
}
async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null) return
  child.send?.('close')
  await Promise.race([
    new Promise<void>((accept) => child.once('exit', () => accept())),
    delay(5000),
  ])
  if (child.exitCode === null) child.kill()
}
async function startApi() {
  const child = fork(resolve('scripts/notification-live-child.ts'), [], {
    execArgv: ['--import', 'tsx'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      NOTIFICATION_TEST_DATABASE: databasePath,
      NOTIFICATION_TEST_REDIS_URL: redisUrl,
      NOTIFICATION_TEST_PREFIX: prefix,
    },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    windowsHide: true,
  })
  children.push(child)
  const port = await new Promise<number>((accept, reject) => {
    const timer = setTimeout(() => reject(Error('API child startup timeout')), 10000)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', () => {
      clearTimeout(timer)
      reject(Error('API child exited during startup'))
    })
    child.once('message', (message) => {
      clearTimeout(timer)
      accept((message as { port: number }).port)
    })
  })
  return `http://127.0.0.1:${port}`
}
async function gql(base: string, cookie: string, query: string) {
  const response = await fetch(`${base}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:5173',
      Cookie: cookie,
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(10000),
  })
  const result = (await response.json()) as { data?: Record<string, any>; errors?: unknown[] }
  assert.equal(result.errors, undefined, JSON.stringify(result.errors))
  return result.data!
}
try {
  let port: number | undefined
  if (!redisUrl) {
    port = await freePort()
    redisUrl = `redis://127.0.0.1:${port}`
  }
  probe = new Redis(redisUrl, {
    enableOfflineQueue: false,
    retryStrategy: () => 100,
    maxRetriesPerRequest: 0,
    connectTimeout: 1000,
    commandTimeout: 1000,
  })
  probe.on('error', () => {})
  if (port) await startRedis(port)
  else
    await until(async () => {
      try {
        return (await probe!.ping()) === 'PONG'
      } catch {
        return false
      }
    }, 'test Redis')
  const a = await startApi(),
    b = await startApi()
  const body = {
    name: 'Live staff',
    email: 'notification-live@example.test',
    password: 'isolated-notification-password-123',
  }
  const signup = await fetch(`${a}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  })
  assert.equal(signup.status, 200)
  const user = ((await signup.json()) as { user: { id: string } }).user
  db.prepare('UPDATE user SET email_verified=1 WHERE id=?').run(user.id)
  db.prepare('INSERT INTO user_roles(user_id,role) VALUES(?,?)').run(user.id, 'STAFF')
  const login = await fetch(`${a}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  })
  assert.equal(login.status, 200)
  const cookie = login.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ')
  await until(
    async () =>
      (
        await fetch(`${b}/api/notifications/stream?scope=WORKSPACE`, {
          headers: { Origin: 'https://foreign.test' },
          signal: AbortSignal.timeout(1000),
        })
      ).status === 403,
    'subscribed API',
  )
  assert.equal(
    (
      await fetch(`${b}/api/notifications/stream?scope=WORKSPACE`, {
        signal: AbortSignal.timeout(1000),
      })
    ).status,
    401,
  )
  const controller = new AbortController()
  streams.push(controller)
  const response = await fetch(`${b}/api/notifications/stream?scope=WORKSPACE`, {
    headers: { Cookie: cookie },
    signal: controller.signal,
  })
  assert.equal(response.status, 200)
  let output = ''
  const reader = response.body!.getReader()
  const consume = (async () => {
    try {
      while (true) {
        const next = await reader.read()
        if (next.done) return
        output += new TextDecoder().decode(next.value)
      }
    } catch {}
  })()
  await until(() => output.includes('event: ready'), 'SSE ready')
  const changes = () => output.split('event: notifications-changed').length - 1
  const count = changes()
  const book = db.prepare('SELECT stock FROM books WHERE id=1').get() as { stock: number }
  await gql(a, cookie, `mutation { adjustBookStock(id:"1",delta:${5 - book.stock}) { stock } }`)
  await until(() => changes() > count, 'cross-process creation invalidation')
  let feed = await gql(
    b,
    cookie,
    'query { notifications(scope:WORKSPACE) { nodes { id kind readAt } } notificationUnreadCount(scope:WORKSPACE) }',
  )
  assert.equal(feed.notificationUnreadCount, 1)
  assert.equal(feed.notifications.nodes[0].kind, 'STOCK_LOW')
  const beforeRead = changes()
  await gql(
    a,
    cookie,
    `mutation { markNotificationRead(scope:WORKSPACE,id:"${feed.notifications.nodes[0].id}") { readAt } }`,
  )
  await until(() => changes() > beforeRead, 'cross-process read invalidation')
  assert.equal(
    (await gql(b, cookie, 'query { notificationUnreadCount(scope:WORKSPACE) }'))
      .notificationUnreadCount,
    0,
  )
  const beforeInvalid = changes()
  await probe.publish(
    `${prefix}:notifications:changed`,
    JSON.stringify({ version: 2, recipientId: user.id, scope: 'WORKSPACE' }),
  )
  await probe.publish(
    `${prefix}:notifications:changed`,
    JSON.stringify({ version: 1, recipientId: 'someone-else', scope: 'WORKSPACE' }),
  )
  await probe.publish(`${prefix}:notifications:changed`, 'x'.repeat(1025))
  await delay(200)
  assert.equal(changes(), beforeInvalid)
  if (port && redisProcess) {
    const stopped = redisProcess
    stopped.kill()
    await new Promise<void>((accept) => {
      if (stopped.exitCode !== null) accept()
      else stopped.once('exit', () => accept())
    })
    await until(
      async () =>
        (
          await fetch(`${b}/api/notifications/stream?scope=WORKSPACE`, {
            headers: { Cookie: cookie },
            signal: AbortSignal.timeout(1000),
          })
        ).status === 503,
      'Redis outage readiness',
    )
    await gql(a, cookie, 'mutation { adjustBookStock(id:"1",delta:-5) { stock } }')
    feed = await gql(
      b,
      cookie,
      'query { notifications(scope:WORKSPACE) { nodes { kind } } notificationUnreadCount(scope:WORKSPACE) }',
    )
    assert.equal(feed.notificationUnreadCount, 1)
    assert.equal(feed.notifications.nodes[0].kind, 'STOCK_OUT')
    const beforeReconnect = changes()
    await startRedis(port)
    await until(() => changes() > beforeReconnect, 'subscriber reconnect reconciliation')
    console.log(
      'Redis outage preserved mutation and GraphQL inbox; subscriber reconnect reconciled SSE',
    )
  } else
    console.log(
      'External test Redis: controlled Redis outage skipped (runner never disrupts supplied servers)',
    )
  db.prepare('DELETE FROM session WHERE user_id=?').run(user.id)
  assert.equal(
    (
      await fetch(`${b}/api/notifications/stream?scope=WORKSPACE`, {
        headers: { Cookie: cookie },
        signal: AbortSignal.timeout(1000),
      })
    ).status,
    401,
  )
  controller.abort()
  await consume
  console.log(
    'PASS: two API processes, real Redis, authenticated SSE, durable stock notifications, cross-process read hints, malformed/foreign hints, revoked session',
  )
} finally {
  for (const controller of streams) controller.abort()
  for (const child of children) await stopChild(child)
  probe?.disconnect()
  redisProcess?.kill()
  db.close()
  // mkdtemp returned this exact task-owned directory; do not accept paths from environment.
  if (
    resolve(directory).startsWith(resolve(tmpdir()) + '\\') ||
    resolve(directory).startsWith(resolve(tmpdir()) + '/')
  )
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
