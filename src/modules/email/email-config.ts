import { decodeEmailKey } from './email-payload.crypto.js'

export type EmailConfig = {
  mode: 'inline' | 'queued'
  orderNotificationsEnabled: boolean
  keys: Record<string, string>
  activeKeyId: string
  dedupeKey?: string
  redisUrl?: string
  prefix: string
  authConcurrency: number
  orderConcurrency: number
  healthPort: number
}
export function loadEmailConfig(
  env: Record<string, string | undefined> = process.env,
  role: 'api' | 'worker' = 'api',
): EmailConfig {
  const production = env.NODE_ENV === 'production'
  const mode = env.EMAIL_DELIVERY_MODE ?? (production ? 'queued' : 'inline')
  if (!['inline', 'queued'].includes(mode) || (production && mode !== 'queued'))
    throw new Error('EMAIL_DELIVERY_MODE must be inline or queued; production requires queued')
  if (role === 'worker' && mode !== 'queued')
    throw new Error('Email worker requires queued delivery mode')
  if (env.EMAIL_ORDER_NOTIFICATIONS_ENABLED === 'true' && mode !== 'queued')
    throw new Error('Order notifications require queued delivery mode')
  if (
    env.EMAIL_ORDER_NOTIFICATIONS_ENABLED &&
    !['true', 'false'].includes(env.EMAIL_ORDER_NOTIFICATIONS_ENABLED)
  )
    throw new Error('EMAIL_ORDER_NOTIFICATIONS_ENABLED must be true or false')
  let keys: Record<string, string> = {}
  const activeKeyId = env.EMAIL_PAYLOAD_ACTIVE_KEY_ID ?? ''
  if (mode === 'queued' || env.EMAIL_PAYLOAD_KEYS) {
    try {
      const parsed: unknown = JSON.parse(env.EMAIL_PAYLOAD_KEYS ?? '')
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        !Object.keys(parsed).length
      )
        throw new Error()
      for (const [id, value] of Object.entries(parsed)) {
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || typeof value !== 'string') throw new Error()
        decodeEmailKey(value)
      }
      keys = parsed as Record<string, string>
    } catch {
      throw new Error('EMAIL_PAYLOAD_KEYS must be a JSON mapping of key IDs to base64 32-byte keys')
    }
    if (!Object.hasOwn(keys, activeKeyId))
      throw new Error('EMAIL_PAYLOAD_ACTIVE_KEY_ID must select a configured key')
  }
  const dedupeKey = env.EMAIL_DEDUPE_KEY
  if (dedupeKey) decodeEmailKey(dedupeKey, 'EMAIL_DEDUPE_KEY')
  if (production && !dedupeKey)
    throw new Error(
      'EMAIL_DEDUPE_KEY is required in production and must remain stable across payload key rotation',
    )
  const redisUrl = env.REDIS_URL
  if (role === 'worker' || redisUrl) {
    try {
      const parsed = new URL(redisUrl ?? '')
      if (
        !['redis:', 'rediss:'].includes(parsed.protocol) ||
        !parsed.hostname ||
        parsed.search ||
        parsed.hash ||
        (production && (parsed.protocol !== 'rediss:' || !parsed.password))
      )
        throw new Error()
    } catch {
      throw new Error(
        'REDIS_URL must be a Redis URL; production workers require authenticated verified TLS',
      )
    }
  }
  const integer = (name: string, fallback: number, max: number) => {
    const raw = env[name] ?? String(fallback)
    const value = Number(raw)
    if (!/^\d+$/.test(raw) || !Number.isInteger(value) || value < 1 || value > max)
      throw new Error(`${name} must be an integer from 1 to ${max}`)
    return value
  }
  const prefix = env.EMAIL_QUEUE_PREFIX ?? `book-store-${env.NODE_ENV ?? 'development'}`
  if (production && !env.EMAIL_QUEUE_PREFIX)
    throw new Error('EMAIL_QUEUE_PREFIX must explicitly identify the production deployment')
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(prefix))
    throw new Error(
      'EMAIL_QUEUE_PREFIX must contain 1 to 100 letters, digits, underscores or hyphens',
    )
  return {
    mode: mode as EmailConfig['mode'],
    orderNotificationsEnabled: env.EMAIL_ORDER_NOTIFICATIONS_ENABLED === 'true',
    keys,
    activeKeyId,
    dedupeKey,
    redisUrl,
    prefix,
    authConcurrency: integer('EMAIL_AUTH_CONCURRENCY', 2, 100),
    orderConcurrency: integer('EMAIL_ORDER_CONCURRENCY', 2, 100),
    healthPort: integer('EMAIL_WORKER_HEALTH_PORT', 4010, 65535),
  }
}
