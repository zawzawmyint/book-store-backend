import 'dotenv/config'
import { createApp } from './app.js'
import { loadConfig } from './config/env.js'
import { openDatabase } from './database/runtime.js'
import { seedRuntimeBooks } from './database/runtime-seed.js'
import { createStripePaymentProvider } from './modules/payments/stripe.provider.js'
import { startPaymentWorker } from './modules/payments/payment.worker.js'

const config = loadConfig()
const database = await openDatabase(config)
let closeApp: (() => Promise<void>) | undefined
try {
  if (config.databaseProvider === 'sqlite' && config.nodeEnv !== 'production')
    await seedRuntimeBooks(database.handle)
  const app = await createApp(
    database.handle,
    {
      frontendOrigin: config.frontendOrigin,
      authBaseURL: config.authBaseURL,
      authSecret: config.authSecret,
      trustedProxyIp: config.trustedProxyIp,
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
  const server = app.listen(config.port)
  await new Promise<void>((accept, reject) => {
    server.once('listening', accept)
    server.once('error', reject)
  })
  console.log(`Book store API: http://localhost:${config.port}/graphql`)
  const stopPaymentWorker = startPaymentWorker(app.locals.payments)

  let stopping = false
  function shutdown() {
    if (stopping) return
    stopping = true
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
      })().catch(() => {
        console.error('Database shutdown failed')
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
