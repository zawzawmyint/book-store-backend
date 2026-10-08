import 'dotenv/config'
import { loadConfig } from '../config/env.js'
import { openDatabase } from './runtime.js'
import { seedDemoAccounts } from './demo-seed.js'

try {
  const config = loadConfig()
  if (config.nodeEnv === 'production') throw new Error('Demo accounts are disabled in production')
  const database = await openDatabase(config)
  try {
    await seedDemoAccounts(database.handle, config, config.nodeEnv)
    console.log('Demo Customer, Staff, and Admin accounts are ready.')
  } finally {
    await database.close()
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Demo seeding failed')
  process.exitCode = 1
}
