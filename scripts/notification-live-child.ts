// Isolated child API process for test-notification-live.ts; never used by application startup.
import { createApp } from '../src/app.js'
import { createDatabase } from '../src/database/connection.js'
const databasePath = process.env.NOTIFICATION_TEST_DATABASE
if (!databasePath || !process.send)
  throw new Error('Notification child requires the isolated parent runner')
const db = createDatabase(databasePath)
const app = await createApp(db, {
  frontendOrigin: 'http://localhost:5173',
  authBaseURL: 'http://localhost:5173',
  authSecret: 'notification-live-isolated-test-secret-at-least-thirty-two',
  emailSender: { async send() {} },
  notificationConfig: {
    enabled: true,
    liveEnabled: true,
    redisUrl: process.env.NOTIFICATION_TEST_REDIS_URL,
    channelPrefix: process.env.NOTIFICATION_TEST_PREFIX!,
  },
})
const server = app.listen(0, '127.0.0.1', () => {
  const address = server.address()
  if (address && typeof address !== 'string') process.send!({ port: address.port })
})
let stopping = false
async function close() {
  if (stopping) return
  stopping = true
  app.locals.closeNotificationStreams()
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
