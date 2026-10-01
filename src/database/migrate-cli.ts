import 'dotenv/config'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { loadConfig } from '../config/env.js'
import { createDatabase } from './connection.js'

const path = resolve(loadConfig().databasePath)
mkdirSync(dirname(path), { recursive: true })
const db = createDatabase(path)
db.close()
console.log(`Database migrations applied in ${path}`)
