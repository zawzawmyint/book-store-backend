import 'dotenv/config'
import { loadConfig } from '../../config/env.js'
import { openDatabase } from '../../database/runtime.js'
import { revokeUnverifiedSessions } from './session-rollout.js'
const mode = process.argv[2]
if (!['preview', 'apply'].includes(mode) || process.argv.length !== 3)
  throw new Error('Usage: auth:revoke-unverified preview|apply')
const database = await openDatabase(loadConfig())
try {
  console.log(
    JSON.stringify({
      mode,
      ...(await revokeUnverifiedSessions(database.handle, mode === 'apply')),
    }),
  )
} finally {
  await database.close()
}
