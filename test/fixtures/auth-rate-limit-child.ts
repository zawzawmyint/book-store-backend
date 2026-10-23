// Spawned only by the isolated Redis test; never opens development data.
import { createApp } from '../../src/app.js'
import { createDatabase } from '../../src/database/connection.js'

if (!process.send || !process.env.AUTH_LIMIT_TEST_URL || !process.env.AUTH_LIMIT_TEST_PREFIX)
  throw new Error('Auth limiter child requires its isolated test parent')
const db = createDatabase(':memory:')
const app = await createApp(db, {
  frontendOrigin: 'http://localhost:5173',
  authBaseURL: 'http://localhost:5173',
  authSecret: 'shared-auth-limiter-fixture-secret-at-least-thirty-two',
  authRateLimit: {
    store: 'redis',
    redisUrl: process.env.AUTH_LIMIT_TEST_URL,
    prefix: process.env.AUTH_LIMIT_TEST_PREFIX,
  },
  emailSender: { async send() {} },
  notificationConfig: { enabled: false, liveEnabled: false, channelPrefix: 'unused' },
})
const server = app.listen(0, '127.0.0.1', () => {
  const address = server.address()
  if (address && typeof address !== 'string') process.send!({ port: address.port })
})
let stopping = false
async function close() {
  if (stopping) return
  stopping = true
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await app.locals.close()
  db.close()
  process.disconnect()
}
process.on('message', (message) => {
  if (message === 'close') void close()
})
process.once('SIGTERM', () => {
  void close()
})
