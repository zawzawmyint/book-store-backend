export type NotificationConfig = {
  enabled: boolean
  liveEnabled: boolean
  redisUrl?: string
  channelPrefix: string
}

export function loadNotificationConfig(
  env: Record<string, string | undefined> = process.env,
): NotificationConfig {
  const flag = (name: string) => {
    if (env[name] !== undefined && !['true', 'false'].includes(env[name]!))
      throw new Error(`${name} must be true or false`)
    return env[name] === 'true'
  }
  const enabled = flag('IN_APP_NOTIFICATIONS_ENABLED')
  const liveEnabled = flag('NOTIFICATION_LIVE_ENABLED')
  if (liveEnabled && !enabled)
    throw new Error('NOTIFICATION_LIVE_ENABLED requires IN_APP_NOTIFICATIONS_ENABLED')
  const production = env.NODE_ENV === 'production'
  const channelPrefix = env.NOTIFICATION_CHANNEL_PREFIX ?? 'book-store-development'
  if (
    (production && liveEnabled && !env.NOTIFICATION_CHANNEL_PREFIX) ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(channelPrefix)
  )
    throw new Error(
      'NOTIFICATION_CHANNEL_PREFIX must explicitly identify production and contain 1 to 100 letters, digits, underscores or hyphens',
    )
  const redisUrl = env.REDIS_URL
  if (liveEnabled) {
    try {
      const url = new URL(redisUrl ?? '')
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
        'REDIS_URL must be a Redis URL; production live notifications require authenticated verified TLS',
      )
    }
  }
  return { enabled, liveEnabled, redisUrl, channelPrefix }
}
