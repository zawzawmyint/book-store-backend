import type { Request, Response } from 'express'
import type { NotificationConfig } from './notification.config.js'
import type { NotificationLive, NotificationHint } from './notification.live.js'
import { log } from '../../shared/logger.js'

type Scope = NotificationHint['scope']
type Options = {
  origin: string
  authorize(req: Request, scope: Scope): Promise<{ userId: string } | { status: 401 | 403 }>
  limits?: { perUser: number; total: number }
  recheckMs?: number
}
type Connection = { userId: string; scope: Scope; invalidate(): void; close(): void }

export function createNotificationStreams(
  config: NotificationConfig,
  live: NotificationLive,
  options: Options,
) {
  const connections = new Set<Connection>()
  const counts = new Map<string, number>()
  const limits = options.limits ?? { perUser: 5, total: 500 }
  let stopping = false
  const unsubscribe = live.subscribe((hint) => {
    for (const connection of connections)
      if (!hint || (hint.recipientId === connection.userId && hint.scope === connection.scope))
        connection.invalidate()
  })
  async function handle(req: Request, res: Response) {
    if (!config.enabled) {
      res.sendStatus(404)
      return
    }
    if (!config.liveEnabled || !live.ready || stopping) {
      res.sendStatus(503)
      return
    }
    const scope = req.query.scope
    if (scope !== 'STOREFRONT' && scope !== 'WORKSPACE') {
      res.sendStatus(400)
      return
    }
    if (req.get('origin') && req.get('origin') !== options.origin) {
      res.sendStatus(403)
      return
    }
    let authorization: Awaited<ReturnType<Options['authorize']>>
    try {
      authorization = await options.authorize(req, scope)
    } catch {
      res.sendStatus(503)
      return
    }
    if ('status' in authorization) {
      res.sendStatus(authorization.status)
      return
    }
    if (req.destroyed || res.destroyed) return
    if (stopping || !live.ready) {
      res.sendStatus(503)
      return
    }
    const userId = authorization.userId
    const requestIdHeader = res.getHeader?.('X-Request-ID')
    const requestId = typeof requestIdHeader === 'string' ? requestIdHeader : undefined
    if (connections.size >= limits.total || (counts.get(userId) ?? 0) >= limits.perUser) {
      res.setHeader('Retry-After', '30')
      res.sendStatus(429)
      return
    }
    let closed = false
    // Keep final end() errors observable after accounting/timers are released.
    let ending = false
    let blocked = false
    let pending = false
    let checking = false
    let pressureTimer: ReturnType<typeof setTimeout> | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let recheck: ReturnType<typeof setInterval> | undefined
    const cleanup = () => {
      if (closed) return
      closed = true
      clearTimeout(pressureTimer)
      clearInterval(heartbeat)
      clearInterval(recheck)
      res.off('drain', drain)
      connections.delete(connection)
      const count = (counts.get(userId) ?? 1) - 1
      if (count) counts.set(userId, count)
      else counts.delete(userId)
    }
    const close = () => {
      if (closed) return
      ending = true
      cleanup()
      try {
        res.end()
      } catch {
        writeFailed()
      }
    }
    const terminate = (streamFailure: 'WRITE_FAILED' | 'BACKPRESSURE') => {
      if (closed && !ending) return
      ending = false
      log('warn', 'notifications.stream_terminated', {
        component: 'http',
        route: '/api/notifications/stream',
        requestId,
        streamFailure,
      })
      cleanup()
      res.destroy()
    }
    const writeFailed = () => terminate('WRITE_FAILED')
    const responseClosed = () => {
      ending = false
      cleanup()
      res.off('error', writeFailed)
    }
    const write = (frame: string) => {
      if (closed) return
      try {
        if (!res.write(frame)) {
          blocked = true
          pressureTimer ??= setTimeout(() => {
            terminate('BACKPRESSURE')
          }, 5000)
          pressureTimer.unref()
        }
      } catch {
        terminate('WRITE_FAILED')
      }
    }
    const invalidate = () => {
      if (blocked) {
        pending = true
        return
      }
      write('event: notifications-changed\ndata: {}\n\n')
    }
    function drain() {
      blocked = false
      clearTimeout(pressureTimer)
      pressureTimer = undefined
      if (pending) {
        pending = false
        invalidate()
      }
    }
    const connection: Connection = { userId, scope, invalidate, close }
    connections.add(connection)
    counts.set(userId, (counts.get(userId) ?? 0) + 1)
    res.once('close', responseClosed)
    res.once('error', writeFailed)
    res.on('drain', drain)
    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    })
    try {
      res.flushHeaders()
    } catch {
      writeFailed()
      return
    }
    write('retry: 5000\nevent: ready\ndata: {}\n\n')
    if (closed) return
    heartbeat = setInterval(() => {
      if (!blocked) write(': heartbeat\n\n')
    }, 15000)
    heartbeat.unref()
    recheck = setInterval(
      () => {
        if (checking || closed) return
        checking = true
        void options
          .authorize(req, scope)
          .then((current) => {
            if ('status' in current || current.userId !== userId) close()
          })
          .catch(close)
          .finally(() => {
            checking = false
          })
      },
      Math.min(options.recheckMs ?? 30000, 30000),
    )
    recheck.unref()
  }
  return {
    get size() {
      return connections.size
    },
    handle,
    close() {
      stopping = true
      unsubscribe()
      for (const connection of connections) connection.close()
    },
  }
}
