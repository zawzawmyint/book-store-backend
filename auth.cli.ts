import 'dotenv/config'
import Database from 'better-sqlite3'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { createAuth } from './src/auth.js'
import { sqliteHandle, type DatabaseHandle } from './src/database/runtime.js'
import * as schema from './src/database/postgresql/schema.js'

// Schema generation is disconnected from application data. Pool construction
// is lazy and this dummy URL is never connected to by the schema generator.
const provider =
  process.env.DB_PROVIDER ?? (process.env.NODE_ENV === 'production' ? 'postgresql' : 'sqlite')
if (!['sqlite', 'postgresql'].includes(provider))
  throw new Error('DB_PROVIDER must be sqlite or postgresql')
if (process.env.NODE_ENV === 'production' && provider !== 'postgresql')
  throw new Error('Production requires PostgreSQL')
const database: DatabaseHandle =
  provider === 'sqlite'
    ? sqliteHandle(new Database(':memory:'))
    : (() => {
        const pool = new Pool({
          connectionString: 'postgresql://schema_generation:unused@127.0.0.1:1/schema_generation',
        })
        return { provider: 'postgresql' as const, pool, orm: drizzle(pool, { schema }) }
      })()
export const auth = createAuth(database, {
  authBaseURL: 'http://localhost:4000',
  authSecret: 'schema-generation-only-secret-with-32-characters',
  frontendOrigin: 'http://localhost:5173',
})
