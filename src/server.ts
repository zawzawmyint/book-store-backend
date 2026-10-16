import 'dotenv/config'
import { createApp } from './app.js'
import { loadConfig } from './config/env.js'
import { openDatabase } from './database/runtime.js'
import { seedRuntimeBooks } from './database/runtime-seed.js'
import { createStripePaymentProvider } from './modules/payments/stripe.provider.js'
import { startPaymentWorker } from './modules/payments/payment.worker.js'
import { createEmailSender } from './modules/email/email.service.js'
import { log } from './shared/logger.js'
import { loadEmailConfig } from './modules/email/email-config.js'

let startupErrorCode = 'CONFIGURATION_INVALID'
async function start() {
  const emailConfig = loadEmailConfig()
  const config = loadConfig({ ...process.env, EMAIL_DELIVERY_MODE: emailConfig.mode })
  startupErrorCode = 'DATABASE_STARTUP_FAILED'
  const database = await openDatabase(config)
  let closeApp: (() => Promise<void>) | undefined
  try {
    startupErrorCode = 'APP_STARTUP_FAILED'
    if (config.databaseProvider === 'sqlite' && config.nodeEnv !== 'production')
      await seedRuntimeBooks(database.handle)
    const app = await createApp(
      database.handle,
      {
        frontendOrigin: config.frontendOrigin,
        authBaseURL: config.authBaseURL,
        authSecret: config.authSecret,
        trustedProxyIp: config.trustedProxyIp,
        emailConfig,
        emailSender:
          emailConfig.mode === 'inline' && config.nodeEnv !== 'test' && config.smtp
            ? createEmailSender(config.smtp)
            : undefined,
      },
      {
        deliveryEnabled: config.deliveryEnabled,
        deliveryCountryCodes: config.deliveryCountryCodes,
        deliveryFeeCents: config.deliveryFeeCents,
        provider: config.stripeCheckoutEnabled
          ? createStripePaymentProvider(config.stripeSecretKey!, config.stripeWebhookSecret!)
          : undefined,
      },
    )
    closeApp = app.locals.close
    startupErrorCode = 'LISTEN_FAILED'
    const server = app.listen(config.port)
    await new Promise<void>((accept, reject) => {
      server.once('listening', accept)
      server.once('error', reject)
    })
    log('info', 'server.started', { component: 'server' })
    const stopPaymentWorker = startPaymentWorker(app.locals.payments)

    let stopping = false
    function shutdown() {
      if (stopping) return
      stopping = true
      log('info', 'server.stopping', { component: 'server' })
      server.close(() => {
        void (async () => {
          try {
            await stopPaymentWorker()
          } finally {
            try {
              await closeApp?.()
            } finally {
              await database.close()
            }
          }
          log('info', 'server.stopped', { component: 'server' })
        })().catch(() => {
          log('error', 'server.shutdown_failed', {
            component: 'server',
            errorCode: 'SHUTDOWN_FAILED',
          })
          process.exitCode = 1
        })
      })
    }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  } catch (error) {
    try {
      await closeApp?.()
    } finally {
      await database.close()
    }
    throw error
  }
}
await start().catch(() => {
  log('error', 'server.start_failed', { component: 'server', errorCode: startupErrorCode })
  process.exitCode = 1
})
