import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'
export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/database/postgresql/schema.ts', './src/database/postgresql/auth-schema.ts'],
  out: './drizzle/postgresql',
})
