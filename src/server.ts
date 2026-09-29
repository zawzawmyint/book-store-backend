import 'dotenv/config'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { createDatabase } from './db.js'
import { seedBooks } from './seed.js'

const config = loadConfig()
const databasePath = resolve(config.databasePath)
mkdirSync(dirname(databasePath), { recursive: true })
const db = createDatabase(databasePath)
if (config.nodeEnv !== 'production') seedBooks(db)
const app = await createApp(db, { frontendOrigin: config.frontendOrigin })
const server = app.listen(config.port, () =>
  console.log(`Book store API: http://localhost:${config.port}/graphql`),
)

function shutdown() {
  server.close(() => db.close())
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
