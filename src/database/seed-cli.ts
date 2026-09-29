import 'dotenv/config'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { loadConfig } from '../config/env.js'
import { createDatabase } from './connection.js'
import { seedBooks } from './seed.js'

const { databasePath } = loadConfig()
const path = resolve(databasePath)
mkdirSync(dirname(path), { recursive: true })
const db = createDatabase(path)
try {
  seedBooks(db)
  console.log(`Sample books seeded in ${path}`)
} finally {
  db.close()
}
