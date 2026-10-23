import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { fork, spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Redis } from 'ioredis'
import {
  createAuthRateLimiter,
  AuthRateLimitUnavailable,
} from '../src/modules/auth-email/auth-rate-limit.js'

const binary = process.env.AUTH_RATE_LIMIT_TEST_REDIS_BINARY
describe.skipIf(!binary)('isolated Redis auth limits', () => {
  afterEach(() => vi.restoreAllMocks())
  let directory: string
  let port: number
  let redisUrl: string
  let redisProcess: ChildProcess
  let probe: Redis
  const children = new Set<ChildProcess>()
  const prefix = `auth-test-${randomUUID()}`
  const closers: (() => void)[] = []
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  async function until(check: () => Promise<unknown>, timeout = 8000) {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      try {
        if (await check()) return
      } catch {
        /* Retry startup/reconnect only. */
      }
      await delay(50)
    }
    throw new Error('Isolated auth Redis readiness timeout')
  }
  async function startRedis() {
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
      { stdio: 'ignore', windowsHide: true },
    )
    let failed = false
    redisProcess.once('error', () => {
      failed = true
    })
    await until(
      async () => !failed && redisProcess.exitCode === null && (await probe.ping()) === 'PONG',
    )
  }
  async function stop(child: ChildProcess) {
    if (child.exitCode !== null || child.signalCode !== null) return
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    child.kill()
    await exited
  }
  async function api() {
    const child = fork(resolve('test/fixtures/auth-rate-limit-child.ts'), [], {
      execArgv: ['--import', 'tsx'],
      windowsHide: true,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        AUTH_LIMIT_TEST_URL: redisUrl,
        AUTH_LIMIT_TEST_PREFIX: prefix,
      },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    children.add(child)
    const childPort = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Isolated API startup timeout')), 15000)
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('exit', () => {
        clearTimeout(timer)
        reject(new Error('Isolated API exited before startup'))
      })
      child.once('message', (message: { port: number }) => {
        clearTimeout(timer)
        resolve(message.port)
      })
    })
    const origin = `http://127.0.0.1:${childPort}`
    await until(async () => (await fetch(`${origin}/ready`)).status === 200)
    return { child, origin }
  }
  const reset = (origin: string, email = 'absent@example.com') =>
    fetch(`${origin}/api/auth/request-password-reset`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'book-store-auth-limit-'))
    const socket = createServer()
    await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve))
    const address = socket.address()
    if (!address || typeof address === 'string') throw new Error('Test port unavailable')
    port = address.port
    await new Promise<void>((resolve) => socket.close(() => resolve()))
    redisUrl = `redis://127.0.0.1:${port}`
    probe = new Redis(redisUrl, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      connectTimeout: 500,
      commandTimeout: 500,
      retryStrategy: () => 50,
    })
    probe.on('error', () => {})
    await startRedis()
  }, 15000)
  afterAll(async () => {
    closers.forEach((close) => close())
    await Promise.all([...children].map(stop))
    probe?.disconnect()
    if (redisProcess) await stop(redisProcess)
    if (directory) await rm(directory, { recursive: true, force: true })
  })
  it('atomically shares budgets, TTL and private keys across independent clients', async () => {
    const config = { store: 'redis' as const, redisUrl, prefix: `${prefix}-atomic` }
    const a = createAuthRateLimiter(config, 'same-secret')
    const b = createAuthRateLimiter(config, 'same-secret')
    const other = createAuthRateLimiter({ ...config, prefix: `${prefix}-other` }, 'same-secret')
    closers.push(a.close, b.close, other.close)
    await until(async () => {
      await a.check()
      await b.check()
      await other.check()
      return true
    })
    const rule = { window: 1, max: 3 }
    const key = '198.51.100.23/request-password-reset'
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).consume(key, rule)),
    )
    expect(results.filter((r) => r.allowed)).toHaveLength(3)
    expect(results.filter((r) => !r.allowed).every((r) => r.retryAfter === 1)).toBe(true)
    const keys = await probe.keys(`${config.prefix}:auth-rate-limit:*`)
    expect(keys).toHaveLength(1)
    expect(keys[0]).toMatch(/:auth-rate-limit:[a-f0-9]{64}$/)
    expect(keys[0]).not.toContain('198.51.100.23')
    const before = await probe.pttl(keys[0]!)
    await delay(100)
    expect((await a.consume(key, rule)).allowed).toBe(false)
    expect(await probe.pttl(keys[0]!)).toBeLessThan(before)
    expect((await other.consume(key, rule)).allowed).toBe(true)
    expect((await a.consume('different-client', rule)).allowed).toBe(true)
    expect((await a.consume(key, { window: 2, max: 3 })).allowed).toBe(true)
    await delay(1100)
    expect((await b.consume(key, rule)).allowed).toBe(true)
    // A connected but unresponsive server must also fail closed within the deadline.
    const warnings: string[] = []
    const recoveries: string[] = []
    vi.spyOn(console, 'warn').mockImplementation((line) => warnings.push(String(line)))
    vi.spyOn(console, 'log').mockImplementation((line) => recoveries.push(String(line)))
    await probe.client('PAUSE', 1500)
    const started = Date.now()
    await expect(b.consume('paused-server', rule)).rejects.toBeInstanceOf(AuthRateLimitUnavailable)
    expect(Date.now() - started).toBeLessThan(2000)
    await delay(600)
    await until(async () => {
      await b.check()
      return true
    })
    expect(
      recoveries.filter((line) => JSON.parse(line).event === 'auth.rate_limit_recovered'),
    ).toHaveLength(1)
    await probe.client('PAUSE', 1500)
    await expect(b.check()).rejects.toBeInstanceOf(AuthRateLimitUnavailable)
    expect(
      warnings.filter((line) => JSON.parse(line).event === 'auth.rate_limit_unavailable'),
    ).toHaveLength(2)
    await delay(600)
    expect((await b.consume('recovered-server', rule)).allowed).toBe(true)
    a.close()
    await expect(a.consume('closed', rule)).rejects.toBeInstanceOf(AuthRateLimitUnavailable)
  })
  it('shares actual HTTP budgets between two processes and across an API restart', async () => {
    const a = await api()
    const b = await api()
    const responses = await Promise.all(
      Array.from({ length: 12 }, (_, i) => reset(i % 2 ? a.origin : b.origin)),
    )
    expect(responses.filter((r) => r.status === 200)).toHaveLength(3)
    expect(responses.filter((r) => r.status === 429)).toHaveLength(9)
    await stop(a.child)
    const restarted = await api()
    expect((await reset(restarted.origin)).status).toBe(429)
    // Untrusted client headers cannot select a fresh IP bucket.
    const spoofed = await fetch(`${b.origin}/api/auth/request-password-reset`, {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        'Content-Type': 'application/json',
        'X-Real-IP': '203.0.113.99',
        'X-Forwarded-For': '203.0.113.99',
        'X-Bookstore-Client-IP': '203.0.113.99',
      },
      body: JSON.stringify({ email: 'different@example.com' }),
    })
    expect(spoofed.status).toBe(429)
    await stop(redisProcess)
    const unavailable = await reset(b.origin)
    expect(unavailable.status).toBe(503)
    expect(await unavailable.json()).toEqual({
      code: 'AUTH_RATE_LIMIT_UNAVAILABLE',
      message: 'Authentication is temporarily unavailable. Please try again shortly.',
    })
    expect((await fetch(`${b.origin}/ready`)).status).toBe(503)
    expect((await fetch(`${b.origin}/health`)).status).toBe(200)
    await startRedis()
    await until(async () => (await fetch(`${b.origin}/ready`)).status === 200)
    expect((await reset(b.origin)).status).toBe(200)
  }, 30000)
})
