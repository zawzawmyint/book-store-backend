import 'dotenv/config'
import { loadConfig } from '../../config/env.js'
import { openDatabase } from '../../database/runtime.js'
import { createAdminRepository } from './admin.repository.js'
import { operatorActor } from '../activity/activity.types.js'

const args = process.argv.slice(2).filter((arg) => arg !== '--')
if (args.length !== 2 || !['grant', 'revoke'].includes(args[0]) || !args[1].trim()) {
  console.error('Usage: bun run admin:access -- grant|revoke <user-id>')
  process.exitCode = 1
} else {
  try {
    const database = await openDatabase(loadConfig())
    try {
      await createAdminRepository(database.handle).setAdminAccess(
        args[1],
        args[0] === 'grant',
        operatorActor,
      )
    } finally {
      await database.close()
    }
    console.log(`${args[0]}: ${args[1]}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Admin access update failed')
    process.exitCode = 1
  }
}
