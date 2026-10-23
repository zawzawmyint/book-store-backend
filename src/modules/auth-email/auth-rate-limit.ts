import { createHmac } from 'node:crypto'
import { Redis } from 'ioredis'
import { log } from '../../shared/logger.js'
import type { AuthRateLimitConfig } from './auth-rate-limit.config.js'

type Rule = { window: number; max: number }
type Decision = { allowed: boolean; retryAfter: number | null }
export class AuthRateLimitUnavailable extends Error {}

// A denied request never increments or extends the original fixed window.
const consumeScript = `
local count = tonumber(redis.call('GET', KEYS[1]))
local ttl = redis.call('PTTL', KEYS[1])
if not count or ttl < 0 then
  redis.call('SET', KEYS[1], 1, 'PX', ARGV[1])
  return {1, 0}
end
if count >= tonumber(ARGV[2]) then
  return {0, math.max(1, math.ceil(ttl / 1000))}
end
redis.call('INCR', KEYS[1])
return {1, 0}
`

export function createAuthRateLimiter(config: AuthRateLimitConfig, secret: string) {
  if (config.store === 'memory') {
    const limits = new Map<string, { count: number; start: number; expiresAt: number }>()
    return {
      async consume(key: string, rule: Rule): Promise<Decision> {
        const now = Date.now()
        if (limits.size > 100_000) {
          for (const [storedKey, value] of limits)
            if (now >= value.expiresAt) limits.delete(storedKey)
          if (limits.size > 100_000) limits.delete(limits.keys().next().value!)
        }
        const prior = limits.get(key)
        if (!prior || now - prior.start >= rule.window * 1000) {
          limits.set(key, { count: 1, start: now, expiresAt: now + rule.window * 1000 })
          return { allowed: true, retryAfter: null }
        }
        if (prior.count >= rule.max)
          return { allowed: false, retryAfter: Math.ceil((prior.expiresAt - now) / 1000) }
        prior.count++
        return { allowed: true, retryAfter: null }
      },
      async check() {},
      close() {
        limits.clear()
      },
    }
  }
  const redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    autoResendUnfulfilledCommands: false,
    maxRetriesPerRequest: 0,
    connectTimeout: 1000,
    commandTimeout: 1000,
    retryStrategy: (attempt) => Math.min(250 * attempt, 5000),
  })
  let closed = false
  let degraded = false
  const unavailable = () => {
    if (!closed && !degraded)
      log('warn', 'auth.rate_limit_unavailable', {
        component: 'server',
        errorCode: 'AUTH_RATE_LIMIT_UNAVAILABLE',
      })
    degraded = true
  }
  const recovered = () => {
    if (degraded && !closed) log('info', 'auth.rate_limit_recovered', { component: 'server' })
    degraded = false
  }
  redis.on('error', unavailable)
  redis.on('close', () => {
    if (!closed) unavailable()
  })
  void redis.connect().catch(unavailable)
  return {
    async consume(key: string, rule: Rule): Promise<Decision> {
      try {
        if (closed) throw new AuthRateLimitUnavailable()
        const digest = createHmac('sha256', secret)
          .update(JSON.stringify([key, rule.window]))
          .digest('hex')
        const result = await redis.eval(
          consumeScript,
          1,
          `${config.prefix}:auth-rate-limit:${digest}`,
          rule.window * 1000,
          rule.max,
        )
        if (
          !Array.isArray(result) ||
          result.length !== 2 ||
          ![0, 1].includes(result[0]) ||
          !Number.isSafeInteger(result[1]) ||
          (result[0] === 0 ? result[1] < 1 : result[1] !== 0)
        )
          throw new AuthRateLimitUnavailable()
        recovered()
        return { allowed: result[0] === 1, retryAfter: result[0] === 1 ? null : result[1] }
      } catch {
        unavailable()
        throw new AuthRateLimitUnavailable()
      }
    },
    async check() {
      try {
        if (closed || (await redis.ping()) !== 'PONG') throw new AuthRateLimitUnavailable()
        recovered()
      } catch {
        unavailable()
        throw new AuthRateLimitUnavailable()
      }
    },
    close() {
      closed = true
      redis.disconnect()
    },
  }
}
