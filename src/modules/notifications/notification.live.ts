import { Redis } from 'ioredis'
import type { NotificationConfig } from './notification.config.js'
import { log } from '../../shared/logger.js'

export type NotificationHint = { recipientId: string; scope: 'STOREFRONT' | 'WORKSPACE' }
export type NotificationLive = {
  readonly ready: boolean
  publish(hint: NotificationHint): Promise<void>
  subscribe(listener: (hint: NotificationHint | null) => void): () => void
  close(): Promise<void>
}
export function parseNotificationHint(message: string): NotificationHint | undefined {
  if (Buffer.byteLength(message) > 1024) return
  try {
    const value: unknown = JSON.parse(message)
    if (!value || typeof value !== 'object') return
    const hint = value as Record<string, unknown>
    if (
      hint.version !== 1 ||
      typeof hint.recipientId !== 'string' ||
      !hint.recipientId.length ||
      hint.recipientId.length > 256 ||
      [...hint.recipientId].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      !['STOREFRONT', 'WORKSPACE'].includes(String(hint.scope))
    )
      return
    return { recipientId: hint.recipientId, scope: hint.scope as NotificationHint['scope'] }
  } catch {
    return
  }
}
export function createNotificationLive(config: NotificationConfig): NotificationLive {
  const listeners = new Set<(hint: NotificationHint | null) => void>()
  let ready = false
  let closed = false
  const dispatch = (hint: NotificationHint | null) => {
    for (const listener of listeners) {
      try {
        listener(hint)
      } catch {
        /* A disconnected stream cannot interrupt other recipients. */
      }
    }
  }
  if (!config.enabled || !config.liveEnabled)
    return {
      get ready() {
        return false
      },
      async publish() {},
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
  const channel = `${config.channelPrefix}:notifications:changed`
  const options = {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    autoResubscribe: false,
    autoResendUnfulfilledCommands: false,
    connectTimeout: 3000,
    commandTimeout: 3000,
    retryStrategy: (attempt: number) => Math.min(250 * attempt, 5000),
  }
  const publisher = new Redis(config.redisUrl!, options)
  const subscriber = new Redis(config.redisUrl!, options)
  const health = {
    publisher: { degraded: false, healthy: false },
    subscriber: { degraded: false, healthy: false },
  }
  let subscriptionGeneration = 0
  const unavailable = (redisConnection: 'publisher' | 'subscriber') => {
    if (closed) return
    if (redisConnection === 'subscriber') {
      ready = false
      subscriptionGeneration++
    }
    const state = health[redisConnection]
    state.healthy = false
    if (state.degraded) return
    state.degraded = true
    log('warn', 'notifications.live_unavailable', {
      component: 'server',
      errorCode: 'NOTIFICATION_LIVE_UNAVAILABLE',
      redisConnection,
    })
  }
  const available = (redisConnection: 'publisher' | 'subscriber') => {
    if (closed) return
    const state = health[redisConnection]
    if (state.healthy) return
    state.degraded = false
    state.healthy = true
    log('info', 'notifications.live_ready', { component: 'server', redisConnection })
  }
  publisher.on('error', () => unavailable('publisher'))
  publisher.on('close', () => unavailable('publisher'))
  publisher.on('ready', () => available('publisher'))
  subscriber.on('error', () => unavailable('subscriber'))
  subscriber.on('close', () => unavailable('subscriber'))
  subscriber.on('ready', () => {
    if (closed) return
    ready = false
    const generation = ++subscriptionGeneration
    void subscriber
      .subscribe(channel)
      .then(() => {
        if (closed || subscriber.status !== 'ready' || generation !== subscriptionGeneration) return
        ready = true
        available('subscriber')
        // Reconcile missed invalidations on every subscription, including reconnect.
        dispatch(null)
      })
      .catch(() => {
        if (generation === subscriptionGeneration) unavailable('subscriber')
      })
  })
  subscriber.on('message', (receivedChannel, message) => {
    if (receivedChannel !== channel) return
    const hint = parseNotificationHint(message)
    if (hint) dispatch(hint)
  })
  void publisher.connect().catch(() => unavailable('publisher'))
  void subscriber.connect().catch(() => unavailable('subscriber'))
  return {
    get ready() {
      return ready
    },
    async publish(hint) {
      if (closed) return
      const message = JSON.stringify({ version: 1, ...hint })
      if (!parseNotificationHint(message)) return
      try {
        await publisher.publish(channel, message)
        if (publisher.status === 'ready') available('publisher')
      } catch {
        unavailable('publisher')
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async close() {
      closed = true
      ready = false
      listeners.clear()
      // disconnect is immediate, bounded, and cannot queue QUIT while Redis is down.
      publisher.disconnect()
      subscriber.disconnect()
    },
  }
}
