import { afterEach, beforeEach, expect, it } from 'vitest'
import request from 'supertest'
import type Database from 'better-sqlite3'
import { createApp } from '../src/app.js'
import { createDatabase } from '../src/database/connection.js'

const options = {
  frontendOrigin: 'http://localhost:5173',
  authBaseURL: 'http://localhost:5173',
  authSecret: 'admin-test-secret-at-least-thirty-two-characters',
}
let db: Database.Database
let app: Awaited<ReturnType<typeof createApp>>
beforeEach(async () => {
  db = createDatabase(':memory:')
  app = await createApp(db, options)
})
afterEach(() => db.close())

it('resolves customer/admin access from membership and revokes an existing session immediately', async () => {
  const anonymous = await request(app).post('/graphql').send({ query: '{ viewer { id role } }' })
  expect(anonymous.body.errors).toBeUndefined()
  expect(anonymous.body.data.viewer).toBeNull()
  const signed = await request(app)
    .post('/api/auth/sign-up/email')
    .set('Origin', options.frontendOrigin)
    .send({
      name: 'Admin',
      email: 'admin@example.com',
      password: 'correct-horse-battery-staple',
      role: 'ADMIN',
    })
  expect(signed.status).toBe(200)
  const cookies = signed.headers['set-cookie'] as string[]
  const id = signed.body.user.id as string
  const viewer = () =>
    request(app)
      .post('/graphql')
      .set('Origin', options.frontendOrigin)
      .set('Cookie', cookies)
      .send({ query: '{ viewer { id role } }' })
  expect((await viewer()).body.data.viewer).toEqual({ id, role: 'CUSTOMER' })
  db.prepare("INSERT INTO user_roles (user_id, role) VALUES (?, 'ADMIN')").run(id)
  expect((await viewer()).body.data.viewer.role).toBe('ADMIN')
  db.prepare("DELETE FROM user_roles WHERE role = 'ADMIN' AND user_id = ?").run(id)
  expect((await viewer()).body.data.viewer.role).toBe('CUSTOMER')
  for (const query of [
    '{ adminBooks { total } }',
    '{ adminOrders { total } }',
    '{ adminCustomers { total } }',
    '{ adminCustomer(id: "missing") { id email } }',
    'mutation { adjustBookStock(id: "1", delta: 1) { id } }',
    'mutation { setCustomerAdminAccess(userId: "missing", enabled: true) { id } }',
    'mutation { resetCustomerPassword(userId: "missing", newPassword: "new-password-123") { id } }',
  ]) {
    const denied = await request(app)
      .post('/graphql')
      .set('Origin', options.frontendOrigin)
      .set('Cookie', cookies)
      .send({ query })
    expect(denied.body.errors[0].extensions.code).toBe('FORBIDDEN')
  }
})
