import 'dotenv/config'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { loadConfig } from '../../config/env.js'
import { createDatabase } from '../../database/connection.js'
import { createAdminRepository } from './admin.repository.js'

const args = process.argv.slice(2).filter((arg) => arg !== '--')
if (args.length !== 2 || !['grant', 'revoke'].includes(args[0]) || !args[1].trim()) {
  console.error('Usage: bun run admin:access -- grant|revoke <user-id>')
  process.exitCode = 1
} else {
  try {
    const path = resolve(loadConfig().databasePath)
    mkdirSync(dirname(path), { recursive: true })
    const db = createDatabase(path)
    try {
      createAdminRepository(db).setAdminAccess(args[1], args[0] === 'grant')
    } finally {
      db.close()
    }
    console.log(`${args[0]}: ${args[1]}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Admin access update failed')
    process.exitCode = 1
  }
}
