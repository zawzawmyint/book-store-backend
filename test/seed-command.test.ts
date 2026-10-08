import { expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'

it('rejects sample catalog seeding in production before connecting', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/database/seed-cli.ts'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DB_PROVIDER: 'postgresql',
      DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/seed_guard',
      FRONTEND_ORIGIN: 'https://store.example.com',
      BETTER_AUTH_URL: 'https://store.example.com',
      BETTER_AUTH_SECRET: 'seed-command-secret-at-least-thirty-two-characters',
      PG_TLS_MODE: 'verify-full',
      STRIPE_CHECKOUT_ENABLED: 'false',
    },
  })
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('Sample catalog seeding is disabled in production')
})
