import Database from 'better-sqlite3'
import { createAuth } from './src/auth.js'

// Schema generation needs an auth instance, but must not write to application data.
export const auth = createAuth(new Database(':memory:'), {
  authBaseURL: 'http://localhost:4000',
  authSecret: 'schema-generation-only-secret-with-32-characters',
  frontendOrigin: 'http://localhost:5173',
})
