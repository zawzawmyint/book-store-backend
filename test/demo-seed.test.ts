import { expect, it } from 'vitest'
import request from 'supertest'
import { createDatabase } from '../src/database/connection.js'
import { createApp } from '../src/app.js'
import { createAuth } from '../src/auth.js'
import { seedDemoAccounts } from '../src/database/demo-seed.js'

const options = {
  frontendOrigin: 'http://localhost:5173',
  authBaseURL: 'http://localhost:5173',
  authSecret: 'demo-test-secret-at-least-thirty-two-characters',
}

it('seeds repeatable accounts with real login sessions and correct roles', async () => {
  const db = createDatabase(':memory:')
  try {
    await seedDemoAccounts(db, options, 'test')
    const users = db.prepare('SELECT id, email FROM user ORDER BY email').all()
    await seedDemoAccounts(db, options, 'test')
    expect(db.prepare('SELECT id, email FROM user ORDER BY email').all()).toEqual(users)
    const app = await createApp(db, options)
    for (const role of ['CUSTOMER', 'STAFF', 'ADMIN']) {
      const login = await request(app)
        .post('/api/auth/sign-in/email')
        .set('Origin', options.frontendOrigin)
        .send({ email: `demo-${role.toLowerCase()}@example.com`, password: 'BookstoreDemo123!' })
      expect(login.status).toBe(200)
      const viewer = await request(app)
        .post('/graphql')
        .set('Origin', options.frontendOrigin)
        .set('Cookie', login.headers['set-cookie'])
        .send({ query: '{ viewer { role } }' })
      expect(viewer.body.errors).toBeUndefined()
      expect(viewer.body.data.viewer.role).toBe(role)
    }
  } finally {
    db.close()
  }
})

it('refuses production without creating accounts', async () => {
  const db = createDatabase(':memory:')
  try {
    await expect(seedDemoAccounts(db, options, 'production')).rejects.toThrow('production')
    expect(db.prepare('SELECT COUNT(*) AS count FROM user').get()).toEqual({ count: 0 })
  } finally {
    db.close()
  }
})

it('rejects a later credential mismatch before creating or promoting any account', async () => {
  const db = createDatabase(':memory:')
  try {
    await createAuth(db, options).api.signUpEmail({
      body: {
        name: 'Existing admin',
        email: 'demo-admin@example.com',
        password: 'DifferentPassword123!',
      },
    })
    const before = db.prepare('SELECT id, email FROM user ORDER BY email').all()
    await expect(seedDemoAccounts(db, options, 'test')).rejects.toThrow('different credentials')
    expect(db.prepare('SELECT id, email FROM user ORDER BY email').all()).toEqual(before)
    expect(db.prepare('SELECT COUNT(*) AS count FROM user_roles').get()).toEqual({ count: 0 })
  } finally {
    db.close()
  }
})
