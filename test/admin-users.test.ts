import { seedSubmittedOrder } from './order-fixtures.js'
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
let adminCookies: string[]
let customerCookies: string[]
let adminId: string
beforeEach(async () => {
  db = createDatabase(':memory:')
  app = await createApp(db, options)
  const insert = db.prepare(
    'INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
  )
  insert.run('a-tie', 'Tie Account', 'tie@example.com', 2_000, 2_000)
  insert.run('c-new', 'Newer Account', 'newer@example.com', 2_000, 2_000)
  insert.run('b-old', 'Older Account', 'older@example.com', 1_000, 1_000)
  insert.run('w-wild', '100% Account', 'wild_card@example.com', 500, 500)
  seedSubmittedOrder(db, { name: 'Guest Only', email: 'guest-only@example.com', totalCents: 100 })
  for (const email of ['admin@example.com', 'customer@example.com']) {
    const res = await request(app)
      .post('/api/auth/sign-up/email')
      .set('Origin', options.frontendOrigin)
      .send({ name: 'Signed Reader', email, password: 'correct-horse-battery-staple' })
    expect(res.status).toBe(200)
    if (email.startsWith('admin')) {
      adminCookies = res.headers['set-cookie'] as string[]
      adminId = res.body.user.id as string
      db.prepare("INSERT INTO user_roles (user_id, role) VALUES (?, 'ADMIN')").run(adminId)
    } else customerCookies = res.headers['set-cookie'] as string[]
  }
})
afterEach(() => db.close())

function gql(query: string, variables: Record<string, unknown> = {}, auth?: string[]) {
  const req = request(app).post('/graphql').set('Origin', options.frontendOrigin)
  if (auth?.length) req.set('Cookie', auth)
  return req.send({ query, variables })
}
const list =
  'query ($search: String, $role: AdminUserRoleFilter, $limit: Int, $offset: Int) { adminUsers(search: $search, role: $role, limit: $limit, offset: $offset) { total items { id name email role createdAt } } }'
const change =
  'mutation ($userId: ID!, $enabled: Boolean!) { setUserAdminAccess(userId: $userId, enabled: $enabled) { id name email role createdAt } }'

it('keeps legacy list and membership operations compatible and deprecated', async () => {
  const legacyList = list
    .replaceAll('AdminUserRoleFilter', 'AdminCustomerRoleFilter')
    .replaceAll('adminUsers', 'adminCustomers')
  for (const variables of [{}, { role: 'ADMIN' }, { search: '%', limit: 1, offset: 0 }]) {
    const current = await gql(list, variables, adminCookies)
    const legacy = await gql(legacyList, variables, adminCookies)
    expect(legacy.body.errors).toBeUndefined()
    expect(legacy.body.data.adminCustomers).toEqual(current.body.data.adminUsers)
  }
  for (const cookies of [undefined, customerCookies]) {
    const current = await gql(list, {}, cookies)
    const legacy = await gql(legacyList, {}, cookies)
    expect(legacy.body.errors[0].extensions.code).toBe(current.body.errors[0].extensions.code)
    expect(legacy.body.data).toBeNull()
  }
  const legacyChange = change.replaceAll('setUserAdminAccess', 'setCustomerAdminAccess')
  for (const enabled of [true, false]) {
    const variables = { userId: 'b-old', enabled }
    const legacy = await gql(legacyChange, variables, adminCookies)
    const current = await gql(change, variables, adminCookies)
    expect(legacy.body.errors).toBeUndefined()
    expect(legacy.body.data.setCustomerAdminAccess).toEqual(current.body.data.setUserAdminAccess)
  }
  const schema = await gql(
    `{ query: __type(name: "Query") { fields(includeDeprecated: true) { name isDeprecated deprecationReason type { ofType { name } } } } mutation: __type(name: "Mutation") { fields(includeDeprecated: true) { name isDeprecated deprecationReason type { ofType { name } } } } }`,
  )
  for (const [kind, name, replacement, type] of [
    ['query', 'adminCustomers', 'adminUsers', 'AdminCustomersPage'],
    ['query', 'adminCustomer', 'adminUser', 'AdminCustomer'],
    ['mutation', 'setCustomerAdminAccess', 'setUserAdminAccess', 'AdminCustomer'],
    ['mutation', 'resetCustomerPassword', 'resetUserPassword', 'AdminCustomer'],
  ]) {
    const field = schema.body.data[kind].fields.find(
      (field: { name: string }) => field.name === name,
    )
    expect(field.isDeprecated).toBe(true)
    expect(field.deprecationReason).toContain(replacement)
    expect(field.type.ofType.name).toBe(type)
  }
})

it('lists registered accounts for an admin, newest first, without guest contacts or private fields', async () => {
  const result = await gql(list, {}, adminCookies)
  expect(result.body.errors).toBeUndefined()
  const page = result.body.data.adminUsers
  expect(page.total).toBe(6)
  expect(page.items.map((item: { id: string }) => item.id)).toContain(adminId)
  expect(page.items.map((item: { email: string }) => item.email)).not.toContain(
    'guest-only@example.com',
  )
  expect(page.items.find((item: { id: string }) => item.id === adminId).role).toBe('ADMIN')
  expect(page.items.find((item: { id: string }) => item.id === 'b-old').role).toBe('CUSTOMER')
  const ordered = await gql(list, { search: 'Account', limit: 4 }, adminCookies)
  expect(ordered.body.data.adminUsers.items.map((item: { id: string }) => item.id)).toEqual([
    'c-new',
    'a-tie',
    'b-old',
    'w-wild',
  ])
  expect(ordered.body.data.adminUsers.items[0].createdAt).toBe('1970-01-01T00:00:02.000Z')
  const hidden = await gql('{ adminUsers { items { emailVerified } } }', {}, adminCookies)
  expect(hidden.body.errors).toBeDefined()
  expect(hidden.body.data?.adminUsers).toBeUndefined()
})

it('filters literal name and email search, role, and pages before returning rows', async () => {
  expect((await gql(list, { search: ' NEWER ' }, adminCookies)).body.data.adminUsers).toMatchObject(
    { total: 1, items: [{ id: 'c-new', email: 'newer@example.com' }] },
  )
  expect(
    (await gql(list, { search: '%' }, adminCookies)).body.data.adminUsers.items.map(
      (item: { id: string }) => item.id,
    ),
  ).toEqual(['w-wild'])
  expect(
    (await gql(list, { search: '_' }, adminCookies)).body.data.adminUsers.items.map(
      (item: { id: string }) => item.id,
    ),
  ).toEqual(['w-wild'])
  expect(
    (await gql(list, { search: 'x'.repeat(101) }, adminCookies)).body.errors[0].extensions.code,
  ).toBe('BAD_USER_INPUT')
  expect((await gql(list, { role: 'ADMIN' }, adminCookies)).body.data.adminUsers.total).toBe(1)
  expect((await gql(list, { role: 'CUSTOMER' }, adminCookies)).body.data.adminUsers.total).toBe(5)
  expect(
    (await gql('{ adminUsers(role: BOGUS) { total } }', {}, adminCookies)).body.errors,
  ).toBeDefined()
  expect((await gql(list, { limit: 51 }, adminCookies)).body.errors[0].extensions.code).toBe(
    'BAD_USER_INPUT',
  )
  expect((await gql(list, { limit: 0 }, adminCookies)).body.errors[0].extensions.code).toBe(
    'BAD_USER_INPUT',
  )
  expect((await gql(list, { offset: -1 }, adminCookies)).body.errors[0].extensions.code).toBe(
    'BAD_USER_INPUT',
  )
  const past = await gql(list, { offset: 1000, limit: 1 }, adminCookies)
  expect(past.body.data.adminUsers).toMatchObject({ total: 6, items: [] })
})

it('rejects guests and customers before revealing accounts, including aliases and mixed operations', async () => {
  const operations = [
    '{ hidden: adminUsers { total items { email } } }',
    '{ books { total } private: adminUsers { items { email name } } }',
    'mutation { setUserAdminAccess(userId: "b-old", enabled: true) { email role } }',
  ]
  for (const query of operations) {
    const customer = await gql(query, {}, customerCookies)
    const guest = await gql(query)
    expect(customer.body.errors[0].extensions.code).toBe('FORBIDDEN')
    expect(guest.body.errors[0].extensions.code).toBe('UNAUTHENTICATED')
    expect(JSON.stringify(customer.body.data)).not.toContain('older@example.com')
    expect(JSON.stringify(guest.body.data)).not.toContain('older@example.com')
  }
  expect(db.prepare("SELECT count(*) AS count FROM user_roles WHERE role = 'ADMIN'").get()).toEqual(
    { count: 1 },
  )
})

it('grants and revokes idempotently, rejects unknown users, and drops the caller on the next request', async () => {
  const before = db.prepare('SELECT count(*) AS count FROM user').get()
  const missing = await gql(change, { userId: 'missing', enabled: true }, adminCookies)
  expect(missing.body.errors[0]).toMatchObject({
    message: 'User was not found',
    extensions: { code: 'BAD_USER_INPUT' },
  })
  expect(
    (await gql(change, { userId: '   ', enabled: true }, adminCookies)).body.errors[0].extensions
      .code,
  ).toBe('BAD_USER_INPUT')
  expect(db.prepare('SELECT count(*) AS count FROM user').get()).toEqual(before)
  const granted = await gql(change, { userId: 'b-old', enabled: true }, adminCookies)
  expect(granted.body.errors).toBeUndefined()
  expect(granted.body.data.setUserAdminAccess).toMatchObject({
    id: 'b-old',
    name: 'Older Account',
    email: 'older@example.com',
    role: 'ADMIN',
  })
  expect(
    (await gql(change, { userId: 'b-old', enabled: true }, adminCookies)).body.data
      .setUserAdminAccess.role,
  ).toBe('ADMIN')
  expect(
    db
      .prepare("SELECT count(*) AS count FROM user_roles WHERE role = 'ADMIN' AND user_id = ?")
      .get('b-old'),
  ).toEqual({ count: 1 })
  expect(db.prepare('SELECT name, email FROM user WHERE id = ?').get('b-old')).toEqual({
    name: 'Older Account',
    email: 'older@example.com',
  })
  expect(
    (await gql(change, { userId: 'b-old', enabled: false }, adminCookies)).body.data
      .setUserAdminAccess.role,
  ).toBe('CUSTOMER')
  expect(
    (await gql(change, { userId: 'b-old', enabled: false }, adminCookies)).body.data
      .setUserAdminAccess.role,
  ).toBe('CUSTOMER')
  expect(
    db
      .prepare("SELECT count(*) AS count FROM user_roles WHERE role = 'ADMIN' AND user_id = ?")
      .get('b-old'),
  ).toEqual({ count: 0 })
  const revoked = await gql(change, { userId: adminId, enabled: false }, adminCookies)
  expect(revoked.body.data.setUserAdminAccess.role).toBe('CUSTOMER')
  expect((await gql(list, {}, adminCookies)).body.errors[0].extensions.code).toBe('FORBIDDEN')
  expect((await gql('{ viewer { role } }', {}, adminCookies)).body.data.viewer.role).toBe(
    'CUSTOMER',
  )
})
