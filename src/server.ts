import 'dotenv/config'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createApp } from './app.js'
import { loadConfig } from './config/env.js'
import { createDatabase } from './database/connection.js'
import { seedBooks } from './database/seed.js'
import { createStripePaymentProvider } from './modules/payments/stripe.provider.js'
import { startPaymentWorker } from './modules/payments/payment.worker.js'

const config = loadConfig()
const databasePath = resolve(config.databasePath)
mkdirSync(dirname(databasePath), { recursive: true })
const db = createDatabase(databasePath)
if (config.nodeEnv !== 'production') seedBooks(db)
const app = await createApp(
  db,
  {
    frontendOrigin: config.frontendOrigin,
    authBaseURL: config.authBaseURL,
    authSecret: config.authSecret,
    trustedProxyIp: config.trustedProxyIp,
  },
  {
    provider: config.stripeCheckoutEnabled
      ? createStripePaymentProvider(config.stripeSecretKey!, config.stripeWebhookSecret!)
      : undefined,
  },
)
const stopPaymentWorker = startPaymentWorker(app.locals.payments)
const server = app.listen(config.port, () =>
  console.log(`Book store API: http://localhost:${config.port}/graphql`),
)

function shutdown() {
  server.close(() => {
    void stopPaymentWorker().then(() => db.close())
  })
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
