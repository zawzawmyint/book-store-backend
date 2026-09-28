import 'dotenv/config'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createApp } from './app.js'
import { createDatabase } from './db.js'

const port = Number(process.env.PORT || 4000)
const databasePath = resolve(process.env.DATABASE_PATH || './data/book-store.sqlite')
mkdirSync(dirname(databasePath), { recursive: true })
const db = createDatabase(databasePath)
const app = await createApp(db)
app.listen(port, () => console.log(`Book store API: http://localhost:${port}/graphql`))
