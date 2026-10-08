import { afterEach, beforeEach, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { createDatabase } from '../src/database/connection.js'
import { createAdminRepository } from '../src/modules/admin/admin.repository.js'
import { operatorActor } from '../src/modules/activity/activity.types.js'
const options = {
  frontendOrigin: 'http://localhost:5173',
  authBaseURL: 'http://localhost:5173',
  authSecret: 'staff-test-secret-at-least-thirty-two-characters',
}
let db: ReturnType<typeof createDatabase>
let app: Awaited<ReturnType<typeof createApp>>
let admin: string[], staff: string[], customer: string[]
let staffId: string, adminId: string
beforeEach(async () => {
  db = createDatabase(':memory:')
  app = await createApp(db, options)
  for (const role of ['admin', 'staff', 'customer']) {
    const res = await request(app)
      .post('/api/auth/sign-up/email')
      .set('Origin', options.frontendOrigin)
      .send({
        name: role,
        email: `${role}@example.com`,
        password: 'staff-password-123',
      })
    expect(res.status).toBe(200)
    const cookies = res.headers['set-cookie'] as string[]
    if (role === 'admin') {
      admin = cookies
      adminId = res.body.user.id
      await createAdminRepository(db).setAdminAccess(adminId, true, operatorActor)
    }
    if (role === 'staff') {
      staff = cookies
      staffId = res.body.user.id
    }
    if (role === 'customer') customer = cookies
  }
})
afterEach(() => db.close())
function gql(query: string, cookies?: string[], variables: Record<string, unknown> = {}) {
  const req = request(app).post('/graphql').set('Origin', options.frontendOrigin)
  if (cookies) req.set('Cookie', cookies)
  return req.send({
    query,
    variables,
  })
}
const assign =
  'mutation($id: ID!, $role: UserRole!) { setUserRole(userId: $id, role: $role) { id role } }'
async function promote() {
  const res = await gql(assign, admin, {
    id: staffId,
    role: 'STAFF',
  })
  expect(res.body.errors).toBeUndefined()
  expect(res.body.data.setUserRole.role).toBe('STAFF')
}
it('assigns staff idempotently, filters roles, and preserves the signup default', async () => {
  expect((await gql('{ viewer { role } }', staff)).body.data.viewer.role).toBe('CUSTOMER')
  await promote()
  await promote()
  const res = await gql(
    '{ viewer { role } adminUsers(role: STAFF) { total items { id role } } adminCustomers(role: STAFF) { total } }',
    admin,
  )
  expect(res.body.errors).toBeUndefined()
  expect(res.body.data.adminUsers).toEqual({
    total: 1,
    items: [
      {
        id: staffId,
        role: 'STAFF',
      },
    ],
  })
  expect(res.body.data.adminCustomers.total).toBe(1)
  expect((await gql('{ viewer { role } }', staff)).body.data.viewer.role).toBe('STAFF')
  expect(
    (
      await gql(assign, admin, {
        id: 'missing',
        role: 'STAFF',
      })
    ).body.errors[0].extensions.code,
  ).toBe('BAD_USER_INPUT')
})
it('lets staff maintain catalog and view orders but denies archive and user management', async () => {
  await promote()
  const created = await gql(
    'mutation { createBook(input: { details: { title: "Staff book", author: "Author", genre: "Fiction", description: "Description", priceCents: 1200 }, stock: 5 }) { id } }',
    staff,
  )
  expect(created.body.errors).toBeUndefined()
  const id = created.body.data.createBook.id
  const edited = await gql(
    `mutation { updateBook(id: "${id}", input: { title: "Edited book", author: "Author", genre: "Fiction", description: "Description", priceCents: 1500 }) { priceCents } adjustBookStock(id: "${id}", delta: 2) { stock } }`,
    staff,
  )
  expect(edited.body.errors).toBeUndefined()
  expect(edited.body.data).toEqual({
    updateBook: {
      priceCents: 1500,
    },
    adjustBookStock: {
      stock: 7,
    },
  })
  expect(
    (await gql('{ adminBooks { total } adminOrders { total } }', staff)).body.errors,
  ).toBeUndefined()
  for (const query of [
    '{ private: adminUsers { total } }',
    '{ adminUser(id: "missing") { id } }',
    'mutation { setBookArchived(id: "missing", archived: true) { id } }',
    `mutation { setUserRole(userId: "${staffId}", role: ADMIN) { id } }`,
    'mutation { resetUserPassword(userId: "missing", newPassword: "password-123") { id } }',
    'mutation { setUserAdminAccess(userId: "missing", enabled: true) { id } }',
    'mutation { setCustomerAdminAccess(userId: "missing", enabled: true) { id } }',
    '{ adminCustomers { total } }',
    '{ adminCustomer(id: "missing") { id } }',
    'mutation { resetCustomerPassword(userId: "missing", newPassword: "password-123") { id } }',
  ])
    expect((await gql(query, staff)).body.errors[0].extensions.code).toBe('FORBIDDEN')
  expect((await gql('{ viewer { role } }', staff)).body.data.viewer.role).toBe('STAFF')
  for (const cookies of [undefined, customer]) {
    expect((await gql('{ adminBooks { total } }', cookies)).body.errors[0].extensions.code).toBe(
      cookies ? 'FORBIDDEN' : 'UNAUTHENTICATED',
    )
    expect(
      (
        await gql(assign, cookies, {
          id: staffId,
          role: 'ADMIN',
        })
      ).body.errors[0].extensions.code,
    ).toBe(cookies ? 'FORBIDDEN' : 'UNAUTHENTICATED')
  }
})
it('demotes live sessions, maps compatibility booleans and allows operator recovery', async () => {
  await promote()
  await gql(
    'mutation($id: ID!) { setUserAdminAccess(userId: $id, enabled: false) { role } }',
    admin,
    {
      id: staffId,
    },
  )
  expect((await gql('{ adminOrders { total } }', staff)).body.errors[0].extensions.code).toBe(
    'FORBIDDEN',
  )
  expect((await gql('{ viewer { role } }', staff)).body.data.viewer.role).toBe('CUSTOMER')
  await gql(assign, admin, {
    id: adminId,
    role: 'STAFF',
  })
  expect((await gql('{ adminUsers { total } }', admin)).body.errors[0].extensions.code).toBe(
    'FORBIDDEN',
  )
  expect((await gql('{ adminOrders { total } }', admin)).body.errors).toBeUndefined()
  await createAdminRepository(db).setAdminAccess(adminId, true, operatorActor)
  expect((await gql('{ adminUsers { total } }', admin)).body.errors).toBeUndefined()
})
