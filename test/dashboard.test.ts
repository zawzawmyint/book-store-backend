import { afterEach, beforeEach, expect, it } from 'vitest'
import request from 'supertest'
import type Database from 'better-sqlite3'
import { createApp } from '../src/app.js'
import { createDatabase } from '../src/database/connection.js'

const options = {
  frontendOrigin: 'http://localhost:5173',
  authBaseURL: 'http://localhost:5173',
  authSecret: 'dashboard-test-secret-at-least-thirty-two-characters',
}
let db: Database.Database
let app: Awaited<ReturnType<typeof createApp>>
const cookies: Record<string, string[]> = {}
beforeEach(async () => {
  db = createDatabase(':memory:')
  app = await createApp(db, options)
  for (const role of ['ADMIN', 'STAFF', 'CUSTOMER']) {
    const response = await request(app)
      .post('/api/auth/sign-up/email')
      .set('Origin', options.frontendOrigin)
      .send({
        name: role,
        email: `${role.toLowerCase()}@dashboard.test`,
        password: 'dashboard-password-123',
      })
    expect(response.status).toBe(200)
    cookies[role] = response.headers['set-cookie'] as string[]
    db.prepare('INSERT INTO user_roles (user_id, role) VALUES (?, ?)').run(
      response.body.user.id,
      role,
    )
  }
})
afterEach(() => db.close())
function gql(query: string, role = 'ADMIN') {
  const call = request(app).post('/graphql').set('Origin', options.frontendOrigin)
  if (cookies[role]) call.set('Cookie', cookies[role])
  return call.send({ query })
}
it('serves empty operations to Staff and rejects guest and Customer access', async () => {
  const query =
    '{ workspaceDashboard { fulfillment { status count } lowStockCount outOfStockCount recentOrders { id } } }'
  const result = await gql(query, 'STAFF')
  expect(result.body.errors).toBeUndefined()
  expect(result.body.data.workspaceDashboard).toEqual({
    fulfillment: ['SUBMITTED', 'PREPARING', 'SHIPPED', 'DELIVERED'].map((status) => ({
      status,
      count: 0,
    })),
    lowStockCount: 0,
    outOfStockCount: 0,
    recentOrders: [],
  })
  expect((await gql(query, 'GUEST')).body.errors[0].extensions.code).toBe('UNAUTHENTICATED')
  expect((await gql(query, 'CUSTOMER')).body.errors[0].extensions.code).toBe('FORBIDDEN')
})
it('guards finance including aliases and mixed selections, and respects role loss', async () => {
  const query =
    '{ workspaceDashboard { lowStockCount } secret: adminDashboardFinance { capturedCents } }'
  expect((await gql(query, 'STAFF')).body.errors[0].extensions.code).toBe('FORBIDDEN')
  const result = await gql(
    '{ adminDashboardFinance { period timeZone currency capturedCents refundedCents netCents days { date } } }',
  )
  expect(result.body.errors).toBeUndefined()
  expect(result.body.data.adminDashboardFinance).toMatchObject({
    period: 'DAYS_30',
    timeZone: 'Asia/Dubai',
    currency: 'usd',
    capturedCents: '0',
    refundedCents: '0',
    netCents: '0',
  })
  expect(result.body.data.adminDashboardFinance.days).toHaveLength(30)
  db.prepare("UPDATE user_roles SET role = 'STAFF' WHERE role = 'ADMIN'").run()
  expect(
    (await gql('{ adminDashboardFinance { capturedCents } }')).body.errors[0].extensions.code,
  ).toBe('FORBIDDEN')
})
it('rejects null and invalid reporting periods', async () => {
  expect(
    (await gql('{ adminDashboardFinance(period: null) { capturedCents } }')).body.errors[0]
      .extensions.code,
  ).toBe('BAD_USER_INPUT')
  expect(
    (await gql('{ adminDashboardFinance(period: WRONG) { capturedCents } }')).body.errors[0]
      .extensions.code,
  ).toBe('GRAPHQL_VALIDATION_FAILED')
})
