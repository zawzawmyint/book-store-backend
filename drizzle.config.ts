import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'
const provider =
  process.env.DB_PROVIDER ?? (process.env.NODE_ENV === 'production' ? 'postgresql' : 'sqlite')
if (provider !== 'sqlite' && provider !== 'postgresql')
  throw new Error('DB_PROVIDER must be sqlite or postgresql')
if (process.env.NODE_ENV === 'production' && provider !== 'postgresql')
  throw new Error('Production requires PostgreSQL')
export default provider === 'postgresql'
  ? defineConfig({
      dialect: 'postgresql',
      schema: ['./src/database/postgresql/schema.ts', './src/database/postgresql/auth-schema.ts'],
      out: './drizzle/postgresql',
    })
  : defineConfig({
      dialect: 'sqlite',
      schema: ['./src/database/schema.ts', './src/database/auth-schema.ts'],
      out: './drizzle',
      dbCredentials: { url: process.env.DATABASE_PATH ?? './data/book-store.sqlite' },
    })
