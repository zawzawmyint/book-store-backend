export type AuthRateLimitConfig =
  { store: 'memory' } | { store: 'redis'; redisUrl: string; prefix: string }

export function loadAuthRateLimitConfig(
  env: Record<string, string | undefined> = process.env,
): AuthRateLimitConfig {
  const production = env.NODE_ENV === 'production'
  const store = env.AUTH_RATE_LIMIT_STORE ?? (production ? 'redis' : 'memory')
  if (store !== 'memory' && store !== 'redis')
    throw new Error('AUTH_RATE_LIMIT_STORE must be memory or redis')
  if (store === 'memory') {
    if (production) throw new Error('Production auth rate limits require Redis')
    return { store }
  }
  const prefix = env.AUTH_RATE_LIMIT_PREFIX ?? ''
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(prefix))
    throw new Error(
      'AUTH_RATE_LIMIT_PREFIX must contain 1 to 100 letters, digits, underscores or hyphens',
    )
  const redisUrl = env.REDIS_URL ?? ''
  try {
    const url = new URL(redisUrl)
    if (
      !['redis:', 'rediss:'].includes(url.protocol) ||
      !url.hostname ||
      url.search ||
      url.hash ||
      (production && (url.protocol !== 'rediss:' || !url.password))
    )
      throw new Error()
  } catch {
    throw new Error(
      'REDIS_URL must be a Redis URL; production auth requires authenticated verified TLS',
    )
  }
  return { store, redisUrl, prefix }
}
