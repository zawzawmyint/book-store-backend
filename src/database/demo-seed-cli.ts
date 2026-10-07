import 'dotenv/config'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { loadConfig } from '../config/env.js'
import { createDatabase } from './connection.js'
import { seedDemoAccounts } from './demo-seed.js'

try {
  const config = loadConfig()
  if (config.nodeEnv === 'production') throw new Error('Demo accounts are disabled in production')
  const path = resolve(config.databasePath)
  mkdirSync(dirname(path), { recursive: true })
  const db = createDatabase(path)
  try {
    await seedDemoAccounts(db, config, config.nodeEnv)
    console.log('Demo Customer, Staff, and Admin accounts are ready.')
  } finally {
    db.close()
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Demo seeding failed')
  process.exitCode = 1
}
