import { afterEach, expect, it, vi } from 'vitest'
import { ApolloServer } from '@apollo/server'
import { Redis } from 'ioredis'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { createDatabase } from '../src/database/connection.js'
import { createAuth } from '../src/auth.js'

const options = {
  frontendOrigin: 'http://localhost:5173',
  authBaseURL: 'http://localhost:5173',
  authSecret: 'auth-limiter-test-secret-at-least-thirty-two-characters',
}
const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of closers.splice(0)) await close()
  vi.restoreAllMocks()
})
it('fails closed with a neutral 503 when shared auth storage is unavailable', async () => {
  const db = createDatabase(':memory:')
  const fixtureAuth = createAuth(db, { ...options, emailSender: { async send() {} } })
  await fixtureAuth.api.signUpEmail({
    body: {
      name: 'Known',
      email: 'known@example.com',
      password: 'correct-horse-battery-staple',
    },
  })
  await fixtureAuth.closeMail()
  const app = await createApp(db, {
    ...options,
    authRateLimit: { store: 'redis', redisUrl: 'redis://127.0.0.1:1', prefix: 'test' },
  })
  closers.push(async () => {
    await app.locals.close()
    db.close()
  })
  for (const email of ['known@example.com', 'unknown@example.com']) {
    const response = await request(app)
      .post('/api/auth/request-password-reset')
      .set('Origin', options.frontendOrigin)
      .send({ email })
    expect(response.status).toBe(503)
    expect(response.body).toEqual({
      code: 'AUTH_RATE_LIMIT_UNAVAILABLE',
      message: 'Authentication is temporarily unavailable. Please try again shortly.',
    })
    expect(response.headers['retry-after']).toBe('5')
  }
  expect((await request(app).get('/ready')).status).toBe(503)
  expect((await request(app).get('/health')).status).toBe(200)
})
it('closes the dedicated Redis client when application startup fails', async () => {
  const db = createDatabase(':memory:')
  closers.push(async () => {
    db.close()
  })
  vi.spyOn(ApolloServer.prototype, 'start').mockRejectedValue(new Error('Injected startup failure'))
  const disconnect = vi.spyOn(Redis.prototype, 'disconnect')
  await expect(
    createApp(db, {
      ...options,
      authRateLimit: { store: 'redis', redisUrl: 'redis://127.0.0.1:1', prefix: 'test' },
    }),
  ).rejects.toThrow('Injected startup failure')
  expect(disconnect).toHaveBeenCalledOnce()
})
