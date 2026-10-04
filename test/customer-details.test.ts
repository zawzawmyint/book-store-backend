import { afterEach, beforeEach, expect, it } from 'vitest'
import request from 'supertest'
import type Database from 'better-sqlite3'
import { createApp } from '../src/app.js'
import { createDatabase } from '../src/database/connection.js'

const options = {
  frontendOrigin: 'http://localhost:5173',
  authBaseURL: 'http://localhost:5173',
  authSecret: 'customer-details-secret-at-least-32-chars',
}
const password = 'correct-horse-battery-staple'
let db: Database.Database
let app: Awaited<ReturnType<typeof createApp>>
let adminCookies: string[]
let customerCookies: string[]
let adminId: string
let customerId: string

beforeEach(async () => {
  db = createDatabase(':memory:')
  app = await createApp(db, options)
  for (const email of ['admin@example.com', 'customer@example.com']) {
    const res = await request(app)
      .post('/api/auth/sign-up/email')
      .set('Origin', options.frontendOrigin)
      .send({ name: email.startsWith('admin') ? 'Ada Admin' : 'Bea Reader', email, password })
    expect(res.status).toBe(200)
    if (email.startsWith('admin')) {
      adminCookies = res.headers['set-cookie'] as string[]
      adminId = res.body.user.id as string
      db.prepare('INSERT INTO admin_memberships (user_id) VALUES (?)').run(adminId)
    } else {
      customerCookies = res.headers['set-cookie'] as string[]
      customerId = res.body.user.id as string
    }
  }
  db.prepare(
    "INSERT INTO orders (user_id, customer_name, email, total_cents) VALUES (?, 'Bea Reader', 'customer@example.com', 100)",
  ).run(customerId)
})
afterEach(() => db.close())

function gql(query: string, variables: Record<string, unknown> = {}, auth?: string[]) {
  const req = request(app).post('/graphql').set('Origin', options.frontendOrigin)
  if (auth?.length) req.set('Cookie', auth)
  return req.send({ query, variables })
}

const read =
  'query ($id: ID!) { adminCustomer(id: $id) { id name email role createdAt } }'
const reset =
  'mutation ($userId: ID!, $newPassword: String!) { resetCustomerPassword(userId: $userId, newPassword: $newPassword) { id name email role createdAt } }'

function storedPassword(userId: string) {
  return db.prepare('SELECT password FROM account WHERE user_id = ? AND provider_id = ?').get(userId, 'credential')
}

function authPost(path: string, body: Record<string, unknown>, cookies?: string[]) {
  const req = request(app).post(path).set('Origin', options.frontendOrigin)
  if (cookies?.length) req.set('Cookie', cookies)
  return req.send(body)
}

it('reads any registered account, including the caller, without private fields', async () => {
  const own = await gql(read, { id: adminId }, adminCookies)
  expect(own.body.errors).toBeUndefined()
  expect(own.body.data.adminCustomer).toMatchObject({
    id: adminId,
    name: 'Ada Admin',
    email: 'admin@example.com',
    role: 'ADMIN',
  })
  const other = await gql(read, { id: customerId }, adminCookies)
  expect(other.body.data.adminCustomer).toMatchObject({
    id: customerId,
    name: 'Bea Reader',
    email: 'customer@example.com',
    role: 'CUSTOMER',
  })
  const hidden = await gql('{ adminCustomer(id: "' + customerId + '") { password } }', {}, adminCookies)
  expect(hidden.body.errors).toBeDefined()
  expect(hidden.body.data?.adminCustomer).toBeUndefined()
})

it('rejects a blank or unknown account without writing', async () => {
  const before = storedPassword(customerId)
  for (const id of ['missing', '   ']) {
    const result = await gql(read, { id }, adminCookies)
    expect(result.body.errors[0]).toMatchObject({
      message: 'User was not found',
      extensions: { code: 'BAD_USER_INPUT' },
    })
  }
  expect(storedPassword(customerId)).toEqual(before)
})

it('rejects guests and customers before revealing an account or changing a password', async () => {
  const before = storedPassword(customerId)
  const operations = [
    `query { hidden: adminCustomer(id: "${customerId}") { email name } }`,
    `query { books { total } private: adminCustomer(id: "${customerId}") { email } }`,
    `mutation { resetCustomerPassword(userId: "${customerId}", newPassword: "new-password-123") { email } }`,
  ]
  for (const query of operations) {
    const customer = await gql(query, {}, customerCookies)
    const guest = await gql(query)
    expect(customer.body.errors[0].extensions.code).toBe('FORBIDDEN')
    expect(guest.body.errors[0].extensions.code).toBe('UNAUTHENTICATED')
    expect(JSON.stringify(customer.body.data)).not.toContain('customer@example.com')
    expect(JSON.stringify(guest.body.data)).not.toContain('customer@example.com')
  }
  expect(storedPassword(customerId)).toEqual(before)
  expect(db.prepare('SELECT count(*) AS count FROM session WHERE user_id = ?').get(customerId)).toEqual({
    count: 1,
  })
})

it('sets another password, removes every session, and leaves the account and order snapshot unchanged', async () => {
  const second = await authPost('/api/auth/sign-in/email', {
    email: 'customer@example.com',
    password,
  })
  expect(second.status).toBe(200)
  const extraCookies = second.headers['set-cookie'] as string[]
  expect(db.prepare('SELECT count(*) AS count FROM session WHERE user_id = ?').get(customerId)).toEqual({
    count: 2,
  })
  const before = storedPassword(customerId) as { password: string }
  const changed = await gql(reset, { userId: customerId, newPassword: 'new-password-123' }, adminCookies)
  expect(changed.body.errors).toBeUndefined()
  expect(changed.body.data.resetCustomerPassword).toMatchObject({
    id: customerId,
    name: 'Bea Reader',
    email: 'customer@example.com',
    role: 'CUSTOMER',
  })
  const body = JSON.stringify(changed.body)
  expect(body).not.toContain('new-password-123')
  expect(body).not.toContain((storedPassword(customerId) as { password: string }).password)
  expect(storedPassword(customerId)).not.toEqual(before)
  expect(db.prepare('SELECT name, email FROM user WHERE id = ?').get(customerId)).toEqual({
    name: 'Bea Reader',
    email: 'customer@example.com',
  })
  expect(db.prepare('SELECT customer_name, email FROM orders').get()).toEqual({
    customer_name: 'Bea Reader',
    email: 'customer@example.com',
  })
  expect(db.prepare('SELECT count(*) AS count FROM admin_memberships WHERE user_id = ?').get(customerId)).toEqual({
    count: 0,
  })
  expect(db.prepare('SELECT count(*) AS count FROM session WHERE user_id = ?').get(customerId)).toEqual({
    count: 0,
  })
  const again = await gql(reset, { userId: customerId, newPassword: 'new-password-123' }, adminCookies)
  expect(again.body.errors).toBeUndefined()
  expect(again.body.data.resetCustomerPassword.email).toBe('customer@example.com')
  expect((await request(app).get('/api/auth/get-session').set('Cookie', customerCookies)).body).toBeNull()
  expect((await request(app).get('/api/auth/get-session').set('Cookie', extraCookies)).body).toBeNull()
  expect((await authPost('/api/auth/sign-in/email', { email: 'customer@example.com', password })).status).toBe(401)
  expect(
    (await authPost('/api/auth/sign-in/email', { email: 'customer@example.com', password: 'new-password-123' })).status,
  ).toBe(200)
})

it('keeps surrounding spaces in a new password', async () => {
  const changed = await gql(reset, { userId: customerId, newPassword: '        ' }, adminCookies)
  expect(changed.body.errors).toBeUndefined()
  expect((await authPost('/api/auth/sign-in/email', { email: 'customer@example.com', password: '        ' })).status).toBe(
    200,
  )
  expect((await request(app).get('/api/auth/get-session').set('Cookie', customerCookies)).body).toBeNull()
})

it('rejects the caller, an out-of-range password, and an account with no password', async () => {
  const adminHash = storedPassword(adminId)
  const customerHash = storedPassword(customerId)
  const self = await gql(reset, { userId: adminId, newPassword: 'new-password-123' }, adminCookies)
  expect(self.body.errors[0]).toMatchObject({
    message: 'Change your own password from your profile.',
    extensions: { code: 'BAD_USER_INPUT' },
  })
  expect((await request(app).get('/api/auth/get-session').set('Cookie', adminCookies)).body.user.id).toBe(adminId)
  for (const newPassword of ['short', 'x'.repeat(129), '1234567']) {
    const result = await gql(reset, { userId: customerId, newPassword }, adminCookies)
    expect(result.body.errors[0].extensions.code).toBe('BAD_USER_INPUT')
  }
  db.prepare(
    'INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
  ).run('no-password', 'No Password', 'none@example.com', 1, 1)
  const missing = await gql(reset, { userId: 'no-password', newPassword: 'new-password-123' }, adminCookies)
  expect(missing.body.errors[0]).toMatchObject({
    message: 'This account has no password.',
    extensions: { code: 'BAD_USER_INPUT' },
  })
  const unknown = await gql(reset, { userId: 'missing', newPassword: 'new-password-123' }, adminCookies)
  expect(unknown.body.errors[0].message).toBe('User was not found')
  expect(storedPassword(adminId)).toEqual(adminHash)
  expect(storedPassword(customerId)).toEqual(customerHash)
  expect(db.prepare('SELECT count(*) AS count FROM session WHERE user_id = ?').get(adminId)).toEqual({ count: 1 })
  expect(db.prepare('SELECT count(*) AS count FROM session WHERE user_id = ?').get(customerId)).toEqual({ count: 1 })
  expect(db.prepare('SELECT count(*) AS count FROM account WHERE user_id = ?').get('no-password')).toEqual({ count: 0 })
})

it('removes another admin session and keeps their membership', async () => {
  const other = await request(app)
    .post('/api/auth/sign-up/email')
    .set('Origin', options.frontendOrigin)
    .send({ name: 'Second Admin', email: 'second@example.com', password })
  expect(other.status).toBe(200)
  const otherId = other.body.user.id as string
  const otherCookies = other.headers['set-cookie'] as string[]
  db.prepare('INSERT INTO admin_memberships (user_id) VALUES (?)').run(otherId)
  const changed = await gql(reset, { userId: otherId, newPassword: 'new-password-123' }, adminCookies)
  expect(changed.body.errors).toBeUndefined()
  expect(changed.body.data.resetCustomerPassword.role).toBe('ADMIN')
  expect(db.prepare('SELECT count(*) AS count FROM admin_memberships WHERE user_id = ?').get(otherId)).toEqual({
    count: 1,
  })
  expect(db.prepare('SELECT count(*) AS count FROM session WHERE user_id = ?').get(otherId)).toEqual({ count: 0 })
  expect((await request(app).get('/api/auth/get-session').set('Cookie', otherCookies)).body).toBeNull()
  expect((await request(app).get('/api/auth/get-session').set('Cookie', adminCookies)).body.user.id).toBe(adminId)
})
