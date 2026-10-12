import 'dotenv/config'
import { loadConfig } from '../config/env.js'
import { openDatabase } from './runtime.js'
import { migratePostgreSQL } from './postgresql/connection.js'

const config = loadConfig()
if (config.databaseProvider === 'postgresql') {
  await migratePostgreSQL(config)
} else {
  const database = await openDatabase(config)
  await database.close()
}
console.log(`Database migrations applied (${config.databaseProvider})`)
