import { afterEach, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { createDatabase } from '../src/database/connection.js'
import { seedBooks } from '../src/database/seed.js'
import { normalizeStore } from '../src/database/persistence.js'
import { loadNotificationConfig } from '../src/modules/notifications/notification.config.js'
import { capturedFixtureSender, verifiedFixtureRequest } from './verified-auth-fixture.js'

const resources: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of resources.splice(0).reverse()) await close()
})

async function fixture(enabled: boolean) {
  const db = createDatabase(':memory:')
  seedBooks(db)
  const options = {
    frontendOrigin: 'http://localhost:5173',
    authBaseURL: 'http://localhost:5173',
    authSecret: 'notification-api-test-at-least-thirty-two-characters',
    emailSender: capturedFixtureSender,
    notificationConfig: loadNotificationConfig({
      IN_APP_NOTIFICATIONS_ENABLED: String(enabled),
    }),
  }
  const app = await createApp(db, options)
  resources.push(async () => {
    await app.locals.close()
    db.close()
  })
  const client = verifiedFixtureRequest(app, db, options)
  async function account(email: string) {
    const response = await client
      .post('/api/auth/sign-up/email')
      .set('Origin', options.frontendOrigin)
      .send({ name: 'Notification reader', email, password: 'notification-test-password-123' })
    expect(response.status).toBe(200)
    const cookies = response.headers['set-cookie'] as unknown as string[]
    return {
      id: response.body.user.id as string,
      cookie: cookies.map((value) => value.split(';')[0]).join('; '),
    }
  }
  const gql = (cookie: string, query: string) =>
    request(app)
      .post('/graphql')
      .set('Cookie', cookie)
      .set('Origin', options.frontendOrigin)
      .send({ query })
  return { app, db, store: normalizeStore(db), account, gql }
}

it('exposes scoped notification data from a real stock mutation and authorizes every read action', async () => {
  const { app, store, account, gql } = await fixture(true)
  const staff = await account('notification-staff@example.com')
  const other = await account('notification-other@example.com')
  await store.setRole(staff.id, 'STAFF')
  const before = (await store.book(1))!
  const mutation = await gql(
    staff.cookie,
    `mutation { adjustBookStock(id:"1", delta:${5 - before.stock}) { stock } }`,
  )
  expect(mutation.body.errors).toBeUndefined()
  expect(mutation.body.data.adjustBookStock.stock).toBe(5)

  const query = `query { notifications(scope:WORKSPACE) { nodes { id kind readAt } } notificationUnreadCount(scope:WORKSPACE) }`
  const feed = await gql(staff.cookie, query)
  expect(feed.body.errors).toBeUndefined()
  expect(feed.body.data.notificationUnreadCount).toBe(1)
  expect(feed.body.data.notifications.nodes).toHaveLength(1)
  const item = feed.body.data.notifications.nodes[0]
  expect(item.kind).toBe('STOCK_LOW')
  expect(item.readAt).toBeNull()

  const denied = await gql(other.cookie, query)
  expect(denied.body.errors[0].extensions.code).toBe('FORBIDDEN')
  const storefront = await gql(staff.cookie, 'query { notificationUnreadCount(scope:STOREFRONT) }')
  expect(storefront.body.data.notificationUnreadCount).toBe(0)
  await store.setRole(other.id, 'STAFF')
  const foreignRead = await gql(
    other.cookie,
    `mutation { markNotificationRead(scope:WORKSPACE, id:"${item.id}") { id } }`,
  )
  expect(foreignRead.body.errors[0].extensions.code).toBe('BAD_USER_INPUT')

  const read = await gql(
    staff.cookie,
    `mutation { markNotificationRead(scope:WORKSPACE, id:"${item.id}") { readAt } }`,
  )
  expect(read.body.data.markNotificationRead.readAt).toBeTruthy()
  expect((await gql(staff.cookie, query)).body.data.notificationUnreadCount).toBe(0)
  await store.setRole(staff.id, 'CUSTOMER')
  expect((await gql(staff.cookie, query)).body.errors[0].extensions.code).toBe('FORBIDDEN')
  const guest = await request(app).post('/graphql').send({ query })
  expect(guest.body.errors[0].extensions.code).toBe('UNAUTHENTICATED')
})

it('leaves existing API working while disabled and reports a stable disabled capability', async () => {
  const { app, account, gql } = await fixture(false)
  const reader = await account('notification-disabled@example.com')
  const result = await gql(reader.cookie, 'query { notificationUnreadCount(scope:STOREFRONT) }')
  expect(result.body.errors[0].extensions.code).toBe('NOTIFICATIONS_DISABLED')
  expect((await request(app).get('/health')).status).toBe(200)
  expect((await request(app).get('/ready')).status).toBe(200)
  expect((await request(app).get('/api/notifications/stream?scope=STOREFRONT')).status).toBe(404)
})
