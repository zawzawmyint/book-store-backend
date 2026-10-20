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
  let degraded = false
  const unavailable = () => {
    if (!degraded && !closed)
      log('warn', 'notifications.live_unavailable', {
        component: 'server',
        errorCode: 'NOTIFICATION_LIVE_UNAVAILABLE',
      })
    degraded = true
  }
  publisher.on('error', unavailable)
  subscriber.on('error', unavailable)
  subscriber.on('close', () => {
    ready = false
    unavailable()
  })
  subscriber.on('ready', () => {
    void subscriber
      .subscribe(channel)
      .then(() => {
        if (closed || subscriber.status !== 'ready') return
        ready = true
        degraded = false
        log('info', 'notifications.live_ready', { component: 'server' })
        // Reconcile missed invalidations on every subscription, including reconnect.
        dispatch(null)
      })
      .catch(unavailable)
  })
  subscriber.on('message', (receivedChannel, message) => {
    if (receivedChannel !== channel) return
    const hint = parseNotificationHint(message)
    if (hint) dispatch(hint)
  })
  void publisher.connect().catch(unavailable)
  void subscriber.connect().catch(unavailable)
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
      } catch {
        unavailable()
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
