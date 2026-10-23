import { afterEach, expect, it, vi } from 'vitest'
import { createNotificationLive } from '../src/modules/notifications/notification.live.js'

const clients = vi.hoisted(
  () =>
    [] as {
      emit(event: string, ...args: unknown[]): boolean
      status: string
      subscribe: ReturnType<typeof vi.fn>
      publish: ReturnType<typeof vi.fn>
      disconnect: ReturnType<typeof vi.fn>
    }[],
)
vi.mock('ioredis', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    Redis: class extends EventEmitter {
      status = 'ready'
      subscribe = vi.fn(async () => 1)
      publish = vi.fn(async () => 1)
      disconnect = vi.fn(() => {
        this.status = 'end'
        this.emit('close')
      })
      async connect() {}
      constructor() {
        super()
        clients.push(this)
      }
    },
  }
})
afterEach(() => {
  clients.splice(0)
  vi.restoreAllMocks()
})
const config = {
  enabled: true,
  liveEnabled: true,
  redisUrl: 'redis://private-redis-secret',
  channelPrefix: 'test',
}
const settle = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

it('reports independent repeated publisher outages and keeps subscriber admission separate', async () => {
  const records: string[] = []
  vi.spyOn(console, 'warn').mockImplementation((line) => records.push(String(line)))
  vi.spyOn(console, 'log').mockImplementation((line) => records.push(String(line)))
  const live = createNotificationLive(config)
  const [publisher, subscriber] = clients
  const invalidations: unknown[] = []
  live.subscribe((hint) => invalidations.push(hint))
  subscriber.emit('ready')
  await settle()
  expect(live.ready).toBe(true)
  publisher.emit('error', new Error('private-error-secret'))
  publisher.emit('error', new Error('private-error-secret'))
  publisher.emit('ready')
  publisher.emit('close')
  publisher.emit('error', new Error('private-error-secret'))
  subscriber.emit('close')
  publisher.emit('ready')
  expect(live.ready).toBe(false)
  subscriber.emit('ready')
  await settle()
  expect(live.ready).toBe(true)
  expect(invalidations).toEqual([null, null])
  const events = records.map((line) => JSON.parse(line))
  expect(
    events.filter(
      (event) =>
        event.event === 'notifications.live_unavailable' && event.redisConnection === 'publisher',
    ),
  ).toHaveLength(2)
  expect(
    events.filter(
      (event) =>
        event.event === 'notifications.live_unavailable' && event.redisConnection === 'subscriber',
    ),
  ).toHaveLength(1)
  expect(
    events.filter(
      (event) =>
        event.event === 'notifications.live_ready' && event.redisConnection === 'publisher',
    ),
  ).toHaveLength(2)
  expect(records.join('')).not.toMatch(/private-error-secret|private-redis-secret/)
  await live.close()
  const count = records.length
  publisher.emit('ready')
  subscriber.emit('ready')
  await settle()
  expect(records).toHaveLength(count)
  expect(live.ready).toBe(false)
})

it('keeps admission closed for failed subscriptions and ignores completion after shutdown', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const info = vi.spyOn(console, 'log').mockImplementation(() => {})
  const live = createNotificationLive(config)
  const subscriber = clients[1]
  subscriber.subscribe.mockRejectedValueOnce(new Error('subscription secret'))
  subscriber.emit('ready')
  await settle()
  expect(live.ready).toBe(false)
  let finish!: (count: number) => void
  subscriber.subscribe.mockImplementationOnce(
    () =>
      new Promise<number>((resolve) => {
        finish = resolve
      }),
  )
  subscriber.emit('ready')
  await settle()
  await live.close()
  finish(1)
  await settle()
  expect(live.ready).toBe(false)
  expect(info).not.toHaveBeenCalled()
})

it('resets publisher outage suppression after a successful best-effort hint without changing stream readiness', async () => {
  const records: string[] = []
  vi.spyOn(console, 'warn').mockImplementation((line) => records.push(String(line)))
  vi.spyOn(console, 'log').mockImplementation((line) => records.push(String(line)))
  const live = createNotificationLive(config)
  const publisher = clients[0]
  const hint = { recipientId: 'reader', scope: 'STOREFRONT' as const }
  publisher.publish.mockRejectedValueOnce(new Error('temporary failure'))
  await live.publish(hint)
  await live.publish(hint)
  publisher.publish.mockRejectedValueOnce(new Error('second failure'))
  await live.publish(hint)
  expect(
    records
      .map((line) => JSON.parse(line))
      .filter(
        (event) =>
          event.event === 'notifications.live_unavailable' && event.redisConnection === 'publisher',
      ),
  ).toHaveLength(2)
  expect(live.ready).toBe(false)
  await live.close()
})
