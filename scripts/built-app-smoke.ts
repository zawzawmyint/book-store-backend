import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { resolve } from 'node:path'

export async function smokeBuiltApp(provider: 'sqlite' | 'postgresql', databaseUrl?: string) {
  const reservation = createServer()
  await new Promise<void>((accept, reject) => {
    reservation.once('error', reject)
    reservation.listen(0, '127.0.0.1', accept)
  })
  const address = reservation.address()
  if (!address || typeof address === 'string') throw new Error('No API test port available')
  const port = address.port
  await new Promise<void>((accept, reject) =>
    reservation.close((error) => (error ? reject(error) : accept())),
  )
  const child = spawn(process.execPath, [resolve('dist/server.js')], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_PROVIDER: provider,
      PORT: String(port),
      DATABASE_PATH: ':memory:',
      DATABASE_URL: databaseUrl,
      PG_TLS_MODE: 'disable',
      PG_CA_FILE: '',
      FRONTEND_ORIGIN: 'http://localhost:5173',
      BETTER_AUTH_URL: 'http://localhost:5173',
      BETTER_AUTH_SECRET: 'built-app-test-secret-at-least-thirty-two-characters',
      DELIVERY_ENABLED: 'false',
      DELIVERY_COUNTRY_CODES: '',
      DELIVERY_FEE_CENTS: '',
      STRIPE_CHECKOUT_ENABLED: 'false',
      STRIPE_SECRET_KEY: '',
      STRIPE_WEBHOOK_SECRET: '',
    },
  })
  // Child stderr may contain driver context. Retain a small diagnostic buffer and
  // emit only recognized static categories, never the captured text or secrets.
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    if (stderr.length < 8192) stderr += chunk.toString('utf8').slice(0, 8192 - stderr.length)
  })
  function startupFailure(message: string): never {
    const reason = stderr.includes('PostgreSQL schema is unavailable or outdated')
      ? 'PostgreSQL schema readiness rejected'
      : stderr.includes('EADDRINUSE')
        ? 'API port unavailable'
        : stderr.includes('ECONNREFUSED')
          ? 'database connection refused'
          : stderr.includes('ENOTFOUND')
            ? 'database host unavailable'
            : stderr.includes('Invalid environment')
              ? 'environment configuration rejected'
              : stderr.includes('Cannot find module') || stderr.includes('ERR_MODULE_NOT_FOUND')
                ? 'compiled module unavailable'
                : 'unclassified child startup failure'
    console.error(
      `Built ${provider} API check: ${reason}; exit code ${child.exitCode ?? 'pending'}`,
    )
    throw new Error(message)
  }
  let launchError: Error | undefined
  child.on('error', (error) => {
    launchError = error
  })
  const exited = new Promise<void>((accept) => child.once('close', () => accept()))
  try {
    const url = `http://127.0.0.1:${port}`
    let ready = false
    for (let attempt = 0; attempt < 40; attempt++) {
      if (launchError || child.exitCode !== null)
        startupFailure(`Built ${provider} API failed to start`)
      try {
        ready = (await fetch(`${url}/health`)).ok
      } catch {
        /* Process is still starting. */
      }
      if (ready) break
      await new Promise((accept) => setTimeout(accept, 250))
    }
    if (!ready) startupFailure(`Built ${provider} API readiness timed out`)
    const result = await (
      await fetch(`${url}/graphql`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ books { total items { id title } } }' }),
      })
    ).json()
    if (result.errors || result.data?.books.total !== 12 || result.data.books.items[0].id !== '1')
      throw new Error(`Built ${provider} API contract failed`)
    console.log(`Same application build verified with ${provider}`)
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM')
    await exited
  }
}
