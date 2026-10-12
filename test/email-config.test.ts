import { expect, it } from 'vitest'
import { loadConfig } from '../src/config/env.js'
const basic = { BETTER_AUTH_SECRET: 'test-secret-at-least-thirty-two-characters' }
it('validates SMTP credentials, encrypted ports and production delivery', () => {
  expect(() => loadConfig({ ...basic, SMTP_HOST: 'smtp.ethereal.email' })).toThrow(/SMTP/)
  expect(() =>
    loadConfig({
      ...basic,
      SMTP_HOST: 'smtp.ethereal.email',
      SMTP_PORT: '587',
      SMTP_SECURE: 'false',
      SMTP_FROM: 'sender@example.com',
      SMTP_USERNAME: 'user',
    }),
  ).toThrow(/SMTP/)
  const smtp = {
    ...basic,
    SMTP_HOST: 'smtp.ethereal.email',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_FROM: 'sender@example.com',
    SMTP_USERNAME: 'user',
    SMTP_PASSWORD: 'secret',
  }
  expect(loadConfig(smtp).smtp?.port).toBe(587)
  expect(() => loadConfig({ ...smtp, SMTP_SECURE: 'true' })).toThrow(/SMTP/)
  expect(() =>
    loadConfig({
      ...smtp,
      NODE_ENV: 'production',
      DB_PROVIDER: 'postgresql',
      DATABASE_URL: 'postgresql://user:pass@localhost/books',
      FRONTEND_ORIGIN: 'https://books.example',
      BETTER_AUTH_URL: 'https://books.example',
    }),
  ).toThrow(/Ethereal/)
})
it('rejects trailing-dot Ethereal hostnames in production', () => {
  expect(() =>
    loadConfig({
      ...basic,
      NODE_ENV: 'production',
      DB_PROVIDER: 'postgresql',
      DATABASE_URL: 'postgresql://user:pass@localhost/books',
      FRONTEND_ORIGIN: 'https://books.example',
      BETTER_AUTH_URL: 'https://books.example',
      SMTP_HOST: 'smtp.ethereal.email.',
      SMTP_PORT: '587',
      SMTP_SECURE: 'false',
      SMTP_FROM: 'sender@example.com',
      SMTP_USERNAME: 'user',
      SMTP_PASSWORD: 'secret',
    }),
  ).toThrow(/Ethereal/)
})
