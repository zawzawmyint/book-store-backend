import EmbeddedPostgres from 'embedded-postgres'
import { randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { loadConfig } from '../src/config/env.js'
import { migratePostgresql } from '../src/database/postgresql/connection.js'
import { openDatabase } from '../src/database/runtime.js'
import { seedRuntimeBooks } from '../src/database/runtime-seed.js'
import { smokeBuiltApp } from './built-app-smoke.js'
import { rejects } from 'node:assert/strict'

const browser = process.argv[2] === 'browser'
const server = createServer()
await new Promise<void>((accept, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', accept)
})
const address = server.address()
if (!address || typeof address === 'string') throw new Error('No PostgreSQL test port available')
const port = address.port
await new Promise<void>((accept, reject) =>
  server.close((error) => (error ? reject(error) : accept())),
)
const directory = await mkdtemp(join(tmpdir(), 'book-store-postgresql-'))
const password = randomUUID()
const runId = randomUUID()
const databaseName = `${browser ? 'book_store_e2e' : 'book_store_test'}_${runId.replaceAll('-', '')}`
const cluster = new EmbeddedPostgres({
  databaseDir: directory,
  port,
  user: 'postgres',
  password,
  persistent: false,
  createPostgresUser: false,
  postgresFlags: ['-h', '127.0.0.1'],
  onLog: () => {},
  onError: () => {},
})
let started = false
let resultCode = 1
let stage = 'cluster initialization'
try {
  await cluster.initialise()
  stage = 'cluster startup'
  await cluster.start()
  started = true
  stage = 'database creation'
  await cluster.createDatabase(databaseName)
  const url = `postgresql://postgres:${password}@127.0.0.1:${port}/${databaseName}`
  const config = loadConfig({
    NODE_ENV: 'test',
    DB_PROVIDER: 'postgresql',
    DATABASE_URL: url,
    PG_TLS_MODE: 'disable',
    BETTER_AUTH_SECRET: 'postgresql-test-secret-at-least-thirty-two-characters',
  })
  stage = 'schema readiness and migrations'
  await rejects(openDatabase(config), /PostgreSQL schema/)
  await migratePostgresql(config)
  await migratePostgresql(config)
  const commandEnv = {
    ...process.env,
    NODE_ENV: 'test',
    DB_PROVIDER: 'postgresql',
    DATABASE_URL: url,
    PG_TLS_MODE: 'disable',
    PG_CA_FILE: '',
    BETTER_AUTH_SECRET: config.authSecret,
    STRIPE_CHECKOUT_ENABLED: 'false',
    STRIPE_SECRET_KEY: '',
    STRIPE_WEBHOOK_SECRET: '',
  }
  async function cli(path: string, args: string[] = []) {
    stage = `command ${path}`
    const code = await new Promise<number>((accept, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', path, ...args], {
        env: commandEnv,
        stdio: 'ignore',
      })
      child.once('error', reject)
      child.once('exit', (code) => accept(code ?? 1))
    })
    if (code !== 0) throw new Error(`PostgreSQL command failed: ${path}`)
  }
  await cli('src/database/migrate-cli.ts')
  await cli('src/database/seed-cli.ts')
  // Browser fixtures own their account setup. Contract tests reset after this
  // command check, so none of these accounts survive into a test case.
  if (!browser) {
    await cli('src/database/demo-seed-cli.ts')
    const accounts = await openDatabase(config)
    try {
      if (accounts.handle.provider !== 'postgresql') throw new Error('Unexpected test provider')
      const user = await accounts.handle.pool.query<{ id: string }>(
        'SELECT id FROM "user" WHERE email=$1',
        ['demo-customer@example.com'],
      )
      await cli('src/modules/admin/admin-access-cli.ts', ['grant', user.rows[0].id])
      await cli('src/modules/admin/admin-access-cli.ts', ['revoke', user.rows[0].id])
    } finally {
      await accounts.close()
    }
  }
  stage = 'catalog initialization'
  const database = await openDatabase(config)
  await seedRuntimeBooks(database.handle)
  await database.close()
  stage = 'compiled SQLite application check'
  await smokeBuiltApp('sqlite')
  stage = 'compiled PostgreSQL application check'
  await smokeBuiltApp('postgresql', url)
  const cwd = browser ? resolve('../frontend') : process.cwd()
  const command = browser
    ? resolve('../frontend/node_modules/@playwright/test/cli.js')
    : resolve('node_modules/vitest/vitest.mjs')
  const args = browser
    ? ['test', ...process.argv.slice(3)]
    : ['run', 'test/database-parity.test.ts', ...process.argv.slice(2)]
  console.log(
    `Running ${browser ? 'browser' : 'database contract'} tests against disposable PostgreSQL`,
  )
  stage = 'test process launch'
  const code = await new Promise<number>((accept, reject) => {
    const child = spawn(process.execPath, [command, ...args], {
      cwd,
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_TEST_PROVIDER: 'postgresql',
        TEST_DATABASE_URL: url,
        TEST_DATABASE_RUN_ID: runId,
        E2E_DB_PROVIDER: 'postgresql',
        E2E_DATABASE_URL: url,
        E2E_DATABASE_RUN_ID: runId,
      },
    })
    child.once('error', reject)
    child.once('exit', (code) => accept(code ?? 1))
  })
  resultCode = code
} catch {
  console.error(`PostgreSQL test setup failed during ${stage}`)
} finally {
  if (started) {
    try {
      await cluster.stop()
    } catch {
      console.error('PostgreSQL test cluster cleanup failed')
      resultCode = 1
    }
  }
}
// embedded-postgres registers a beforeExit hook that exits with zero. Preserve
// the test result explicitly after awaiting cluster cleanup.
process.exit(resultCode)
