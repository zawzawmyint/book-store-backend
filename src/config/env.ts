import { isIP } from 'node:net'

export type AppConfig = {
  port: number
  databasePath: string
  databaseProvider: 'sqlite' | 'postgresql'
  databaseUrl?: string
  pgPoolMax: number
  pgTlsMode: 'verify-full' | 'disable'
  pgCaFile?: string
  frontendOrigin: string
  authBaseURL: string
  authSecret: string
  trustedProxyIp?: string
  nodeEnv: 'development' | 'test' | 'production'
  stripeCheckoutEnabled: boolean
  stripeSecretKey?: string
  stripeWebhookSecret?: string
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const port = Number(env.PORT ?? 4000)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535')
  }

  const databasePath = env.DATABASE_PATH ?? './data/book-store.sqlite'

  const frontendOrigin = env.FRONTEND_ORIGIN ?? 'http://localhost:5173'
  try {
    const parsed = new URL(frontendOrigin)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== frontendOrigin) {
      throw new Error('Invalid origin')
    }
  } catch {
    throw new Error('FRONTEND_ORIGIN must be an HTTP origin such as http://localhost:5173')
  }

  const nodeEnv = env.NODE_ENV ?? 'development'
  if (nodeEnv !== 'development' && nodeEnv !== 'test' && nodeEnv !== 'production') {
    throw new Error('NODE_ENV must be development, test, or production')
  }
  const databaseProvider = env.DB_PROVIDER ?? (nodeEnv === 'production' ? 'postgresql' : 'sqlite')
  if (databaseProvider !== 'sqlite' && databaseProvider !== 'postgresql')
    throw new Error('DB_PROVIDER must be sqlite or postgresql')
  if (nodeEnv === 'production' && databaseProvider !== 'postgresql')
    throw new Error('Production requires PostgreSQL')
  if (databaseProvider === 'sqlite' && !databasePath.trim())
    throw new Error('DATABASE_PATH must not be empty')
  const databaseUrl = env.DATABASE_URL
  const pgPoolMax = Number(env.PG_POOL_MAX ?? 10)
  if (!Number.isInteger(pgPoolMax) || pgPoolMax < 1 || pgPoolMax > 100)
    throw new Error('PG_POOL_MAX must be an integer from 1 to 100')
  const pgTlsMode = env.PG_TLS_MODE ?? (nodeEnv === 'production' ? 'verify-full' : 'disable')
  if (pgTlsMode !== 'verify-full' && pgTlsMode !== 'disable')
    throw new Error('PG_TLS_MODE must be verify-full or disable')
  if (nodeEnv === 'production' && pgTlsMode !== 'verify-full')
    throw new Error('Production requires verified TLS')
  const pgCaFile = env.PG_CA_FILE || undefined
  if (databaseProvider === 'postgresql') {
    let url: URL
    try {
      url = new URL(databaseUrl ?? '')
      if (
        !['postgresql:', 'postgres:'].includes(url.protocol) ||
        !url.hostname ||
        url.pathname.length < 2
      )
        throw new Error()
    } catch {
      throw new Error('DATABASE_URL must be a PostgreSQL URL with host and database name')
    }
    // URL SSL options otherwise overwrite pg's explicit ssl object, including CA verification.
    if ([...url.searchParams.keys()].some((key) => /^(ssl|uselibpqcompat)/i.test(key)))
      throw new Error(
        'DATABASE_URL TLS options conflict with PG_TLS_MODE; use PG_TLS_MODE and PG_CA_FILE',
      )
    if (pgCaFile && pgTlsMode === 'disable') throw new Error('PG_CA_FILE requires verified TLS')
  }

  const authBaseURL = env.BETTER_AUTH_URL ?? frontendOrigin
  try {
    const parsed = new URL(authBaseURL)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== authBaseURL) {
      throw new Error('Invalid origin')
    }
  } catch {
    throw new Error('BETTER_AUTH_URL must be an HTTP origin such as http://localhost:5173')
  }
  const authSecret = env.BETTER_AUTH_SECRET
  if (!authSecret || authSecret.length < 32) {
    throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters')
  }
  const trustedProxyIp = env.AUTH_TRUSTED_PROXY_IP || undefined
  if (trustedProxyIp && !isIP(trustedProxyIp)) {
    throw new Error('AUTH_TRUSTED_PROXY_IP must be an IP address')
  }
  if (
    nodeEnv === 'production' &&
    (!authBaseURL.startsWith('https://') || !frontendOrigin.startsWith('https://'))
  ) {
    throw new Error('Production auth and frontend origins must use HTTPS')
  }

  const stripeCheckoutEnabled = env.STRIPE_CHECKOUT_ENABLED === 'true'
  if (env.STRIPE_CHECKOUT_ENABLED && !['true', 'false'].includes(env.STRIPE_CHECKOUT_ENABLED))
    throw new Error('STRIPE_CHECKOUT_ENABLED must be true or false')
  const stripeSecretKey = env.STRIPE_SECRET_KEY || undefined
  const stripeWebhookSecret = env.STRIPE_WEBHOOK_SECRET || undefined
  if (stripeSecretKey && !/^sk_test_[A-Za-z0-9]+$/.test(stripeSecretKey))
    throw new Error('STRIPE_SECRET_KEY must be a test server key')
  if (stripeCheckoutEnabled && (!stripeSecretKey || !stripeWebhookSecret?.startsWith('whsec_')))
    throw new Error('Enabled Stripe checkout requires test server and webhook signing secrets')
  return {
    port,
    databasePath,
    databaseProvider,
    databaseUrl,
    pgPoolMax,
    pgTlsMode,
    pgCaFile,
    frontendOrigin,
    authBaseURL,
    authSecret,
    trustedProxyIp,
    nodeEnv,
    stripeCheckoutEnabled,
    stripeSecretKey,
    stripeWebhookSecret,
  }
}
