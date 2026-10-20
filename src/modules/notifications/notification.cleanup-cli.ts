import 'dotenv/config'
import { loadConfig } from '../../config/env.js'
import { openDatabase } from '../../database/runtime.js'
import { cleanupNotifications } from './notification.repository.js'
const database = await openDatabase(loadConfig())
try {
  console.log(
    JSON.stringify({
      event: 'notifications_cleanup',
      ...(await cleanupNotifications(database.handle)),
    }),
  )
} finally {
  await database.close()
}
