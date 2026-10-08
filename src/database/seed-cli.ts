import 'dotenv/config'
import { loadConfig } from '../config/env.js'
import { openDatabase } from './runtime.js'
import { seedRuntimeBooks } from './runtime-seed.js'

const config = loadConfig()
if (config.nodeEnv === 'production')
  throw new Error('Sample catalog seeding is disabled in production')
const database = await openDatabase(config)
try {
  await seedRuntimeBooks(database.handle)
  console.log('Sample catalog seed completed for the configured database.')
} finally {
  await database.close()
}
