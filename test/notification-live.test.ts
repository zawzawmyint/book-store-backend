import { describe, expect, it } from 'vitest'
import { loadNotificationConfig } from '../src/modules/notifications/notification.config.js'

describe('notification configuration independence and safe defaults', () => {
  it('defaults off without requiring email keys or Redis', () => {
    expect(loadNotificationConfig({})).toEqual({
      enabled: false,
      liveEnabled: false,
      channelPrefix: 'book-store-development',
      redisUrl: undefined,
    })
    expect(loadNotificationConfig({ IN_APP_NOTIFICATIONS_ENABLED: 'true' }).enabled).toBe(true)
  })
  it('rejects live without inbox, invalid flags and insecure production Redis', () => {
    expect(() => loadNotificationConfig({ NOTIFICATION_LIVE_ENABLED: 'true' })).toThrow()
    expect(() => loadNotificationConfig({ IN_APP_NOTIFICATIONS_ENABLED: 'yes' })).toThrow()
    const live = { IN_APP_NOTIFICATIONS_ENABLED: 'true', NOTIFICATION_LIVE_ENABLED: 'true' }
    expect(() => loadNotificationConfig(live)).toThrow('REDIS_URL')
    expect(() =>
      loadNotificationConfig({
        ...live,
        NODE_ENV: 'production',
        REDIS_URL: 'redis://localhost:6379',
        NOTIFICATION_CHANNEL_PREFIX: 'prod',
      }),
    ).toThrow('REDIS_URL')
    expect(() =>
      loadNotificationConfig({
        ...live,
        NODE_ENV: 'production',
        REDIS_URL: 'rediss://user:secret@example.test:6379',
      }),
    ).toThrow('NOTIFICATION_CHANNEL_PREFIX')
    expect(
      loadNotificationConfig({
        ...live,
        NODE_ENV: 'production',
        REDIS_URL: 'rediss://user:secret@example.test:6379',
        NOTIFICATION_CHANNEL_PREFIX: 'prod',
      }).liveEnabled,
    ).toBe(true)
  })
})
import express from 'express'
import request from 'supertest'
import { once } from 'node:events'
import { createNotificationStreams } from '../src/modules/notifications/notification.sse.js'
import type {
  NotificationHint,
  NotificationLive,
} from '../src/modules/notifications/notification.live.js'

function liveFixture() {
  const listeners = new Set<(hint: NotificationHint | null) => void>()
  const live: NotificationLive = {
    ready: true,
    async publish(hint) {
      for (const listener of listeners) listener(hint)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async close() {
      listeners.clear()
    },
  }
  return live
}
function fixture(
  options: {
    enabled?: boolean
    liveEnabled?: boolean
    authorized?: boolean
    scopeAllowed?: boolean
    limits?: { perUser: number; total: number }
    recheckMs?: number
  } = {},
) {
  const app = express()
  const live = liveFixture()
  let authorized = options.authorized ?? true
  const streams = createNotificationStreams(
    {
      enabled: options.enabled ?? true,
      liveEnabled: options.liveEnabled ?? true,
      channelPrefix: 'test',
    },
    live,
    {
      origin: 'http://localhost:5173',
      async authorize(_req, scope) {
        return !authorized
          ? { status: 401 as const }
          : scope === 'WORKSPACE' && options.scopeAllowed === false
            ? { status: 403 as const }
            : { userId: 'reader' }
      },
      limits: options.limits,
      recheckMs: options.recheckMs,
    },
  )
  app.get('/api/notifications/stream', streams.handle)
  return {
    app,
    live,
    streams,
    revoke() {
      authorized = false
    },
  }
}
it('rejects disabled, degraded, invalid, foreign-origin and unauthorized streams before opening', async () => {
  const path = '/api/notifications/stream?scope=STOREFRONT'
  expect((await request(fixture({ enabled: false }).app).get(path)).status).toBe(404)
  expect((await request(fixture({ liveEnabled: false }).app).get(path)).status).toBe(503)
  expect((await request(fixture().app).get('/api/notifications/stream?scope=OTHER')).status).toBe(
    400,
  )
  expect((await request(fixture().app).get(path).set('Origin', 'https://evil.test')).status).toBe(
    403,
  )
  expect((await request(fixture({ authorized: false }).app).get(path)).status).toBe(401)
  expect(
    (
      await request(fixture({ scopeAllowed: false }).app).get(
        '/api/notifications/stream?scope=WORKSPACE',
      )
    ).status,
  ).toBe(403)
})
it('streams only matching recipient hints, enforces caps, and closes revoked sessions and shutdown', async () => {
  const f = fixture({ limits: { perUser: 1, total: 1 }, recheckMs: 30 })
  const server = f.app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as { port: number }
  const controller = new AbortController()
  try {
    const url = `http://127.0.0.1:${address.port}/api/notifications/stream?scope=STOREFRONT`
    const response = await fetch(url, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]),
    })
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(response.headers.get('x-accel-buffering')).toBe('no')
    const reader = response.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: ready')
    expect((await fetch(url)).status).toBe(429)
    await f.live.publish({ recipientId: 'someone-else', scope: 'STOREFRONT' })
    await f.live.publish({ recipientId: 'reader', scope: 'WORKSPACE' })
    await f.live.publish({ recipientId: 'reader', scope: 'STOREFRONT' })
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      'event: notifications-changed\ndata: {}\n\n',
    )
    f.revoke()
    expect((await reader.read()).done).toBe(true)
    expect(f.streams.size).toBe(0)
  } finally {
    controller.abort()
    f.streams.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

import { EventEmitter } from 'node:events'
import { vi } from 'vitest'
import type { Request, Response } from 'express'
it('coalesces blocked writes, resumes one hint on drain and destroys persistently slow streams', async () => {
  vi.useFakeTimers()
  const live = liveFixture()
  const streams = createNotificationStreams(
    { enabled: true, liveEnabled: true, channelPrefix: 'test' },
    live,
    {
      origin: 'http://localhost:5173',
      async authorize() {
        return { userId: 'reader' }
      },
    },
  )
  const frames: string[] = []
  let writable = false
  const response = Object.assign(new EventEmitter(), {
    destroyed: false,
    status() {
      return this
    },
    set() {
      return this
    },
    flushHeaders() {},
    write(frame: string) {
      frames.push(frame)
      return writable
    },
    end() {
      this.emit('close')
    },
    destroy() {
      this.destroyed = true
      this.emit('close')
    },
  })
  const req = {
    query: { scope: 'STOREFRONT' },
    get() {
      return undefined
    },
    destroyed: false,
  } as unknown as Request
  try {
    await streams.handle(req, response as unknown as Response)
    for (let i = 0; i < 100; i++) await live.publish({ recipientId: 'reader', scope: 'STOREFRONT' })
    expect(frames).toHaveLength(1)
    writable = true
    response.emit('drain')
    expect(frames).toHaveLength(2)
    expect(frames[1]).toBe('event: notifications-changed\ndata: {}\n\n')
    writable = false
    await live.publish({ recipientId: 'reader', scope: 'STOREFRONT' })
    await vi.advanceTimersByTimeAsync(5001)
    expect(response.destroyed).toBe(true)
    expect(streams.size).toBe(0)
    expect(response.listenerCount('drain')).toBe(0)
  } finally {
    streams.close()
    vi.useRealTimers()
  }
})

it.each([
  'write',
  'backpressure',
  'response-error',
  'flush-headers',
  'end-throw',
  'end-error',
] as const)(
  'logs one safe %s termination and releases stream accounting and timers',
  async (failure) => {
    vi.useFakeTimers()
    const warnings: string[] = []
    const warning = vi
      .spyOn(console, 'warn')
      .mockImplementation((line) => warnings.push(String(line)))
    const live = liveFixture()
    const streams = createNotificationStreams(
      { enabled: true, liveEnabled: true, channelPrefix: 'test' },
      live,
      {
        origin: 'http://localhost:5173',
        async authorize() {
          return { userId: 'private-recipient' }
        },
      },
    )
    const response = Object.assign(new EventEmitter(), {
      destroyed: false,
      status() {
        return this
      },
      set() {
        return this
      },
      flushHeaders() {
        if (failure === 'flush-headers') throw new Error('private-write-secret')
      },
      write() {
        if (failure === 'write') throw new Error('private-write-secret')
        return false
      },
      end() {
        if (failure === 'end-throw') throw new Error('private-write-secret')
        if (failure === 'end-error') {
          queueMicrotask(() => this.emit('error', new Error('private-write-secret')))
          return
        }
        this.emit('close')
      },
      destroy() {
        this.destroyed = true
        this.emit('close')
      },
    })
    try {
      await streams.handle(
        { query: { scope: 'STOREFRONT' }, get() {}, destroyed: false } as unknown as Request,
        response as unknown as Response,
      )
      if (failure === 'response-error') response.emit('error', new Error('private-write-secret'))
      if (failure === 'end-throw' || failure === 'end-error') streams.close()
      await vi.advanceTimersByTimeAsync(5001)
      await live.publish({ recipientId: 'private-recipient', scope: 'STOREFRONT' })
      expect(warnings.map((line) => JSON.parse(line))).toEqual([
        expect.objectContaining({
          event: 'notifications.stream_terminated',
          level: 'warn',
          route: '/api/notifications/stream',
          streamFailure: failure === 'backpressure' ? 'BACKPRESSURE' : 'WRITE_FAILED',
        }),
      ])
      expect(warnings.join('')).not.toMatch(/private-write-secret|private-recipient/)
      expect(streams.size).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
      expect(response.listenerCount('error')).toBe(0)
    } finally {
      streams.close()
      warning.mockRestore()
      vi.useRealTimers()
    }
  },
)

it.each(['reject', 'revoke'] as const)(
  'ignores a pending authorization %s after the response has closed',
  async (outcome) => {
    vi.useFakeTimers()
    const live = liveFixture()
    let authorizeCount = 0
    let resolveRecheck!: (value: { status: 401 }) => void
    let rejectRecheck!: (error: Error) => void
    const streams = createNotificationStreams(
      { enabled: true, liveEnabled: true, channelPrefix: 'test' },
      live,
      {
        origin: 'http://localhost:5173',
        recheckMs: 10,
        authorize() {
          if (++authorizeCount === 1) return Promise.resolve({ userId: 'reader' })
          return new Promise<{ status: 401 }>((resolve, reject) => {
            resolveRecheck = resolve
            rejectRecheck = reject
          })
        },
      },
    )
    let ends = 0
    const response = Object.assign(new EventEmitter(), {
      destroyed: false,
      status() {
        return this
      },
      set() {
        return this
      },
      flushHeaders() {},
      write() {
        return true
      },
      end() {
        ends++
        this.emit('close')
      },
      destroy() {
        this.destroyed = true
        this.emit('close')
      },
    })
    try {
      await streams.handle(
        { query: { scope: 'STOREFRONT' }, get() {}, destroyed: false } as unknown as Request,
        response as unknown as Response,
      )
      await vi.advanceTimersByTimeAsync(11)
      response.destroy()
      if (outcome === 'reject') rejectRecheck(new Error('private-auth-secret'))
      else resolveRecheck({ status: 401 })
      await vi.advanceTimersByTimeAsync(1)
      expect(ends).toBe(0)
      expect(streams.size).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
      expect(response.listenerCount('error')).toBe(0)
    } finally {
      streams.close()
      vi.useRealTimers()
    }
  },
)
