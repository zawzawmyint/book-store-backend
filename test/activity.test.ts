import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { createDatabase } from '../src/database/connection.js'
import { createAdminRepository } from '../src/modules/admin/admin.repository.js'
import { createAdminBookRepository } from '../src/modules/books/admin-book.repository.js'
import { operatorActor } from '../src/modules/activity/activity.types.js'
import { seedBooks } from '../src/database/seed.js'
import { activityInputSchema } from '../src/modules/activity/activity.validation.js'
import { createActivityRepository } from '../src/modules/activity/activity.repository.js'
import { FakePaymentProvider } from './fake-payment-provider.js'
import { randomUUID } from 'node:crypto'
const details = {
  title: 'Title',
  author: 'Author',
  genre: 'Genre',
  description: 'Description',
  priceCents: 100,
}
const options = {
  frontendOrigin: 'http://localhost:5173',
  authBaseURL: 'http://localhost:5173',
  authSecret: 'activity-secret-at-least-thirty-two-characters',
}
describe('audited writes', () => {
  let db: ReturnType<typeof createDatabase>
  beforeEach(() => {
    db = createDatabase(':memory:')
    db.exec(
      "INSERT INTO user (id, name, email) VALUES ('actor','Original actor','actor@example.com'), ('target','Original target','target@example.com'); INSERT INTO user_roles VALUES ('actor','ADMIN')",
    )
  })
  afterEach(() => db.close())
  const stored = () =>
    db.prepare('SELECT * FROM activity_events ORDER BY id').all() as Array<Record<string, unknown>>
  it('logs seven write actions exactly once, captures only changed allowlisted values, and omits noops', async () => {
    const admin = createAdminRepository(db)
    const actor = await admin.getActivityActor('actor')
    const books = createAdminBookRepository(db)
    const book = await books.create(details, 10, actor)
    const id = String(book.id)
    await books.update(
      id,
      {
        ...details,
        title: 'Edited',
        priceCents: 200,
      },
      actor,
    )
    await books.update(
      id,
      {
        ...details,
        title: 'Edited',
        priceCents: 200,
      },
      actor,
    )
    await books.adjustStock(id, -2, actor)
    await books.archive(id, true, actor)
    await books.archive(id, true, actor)
    await books.archive(id, false, actor)
    await admin.setUserRole('target', 'STAFF', actor)
    await admin.setUserRole('target', 'STAFF', actor)
    db.exec(
      "INSERT INTO account (id, account_id, provider_id, user_id, password, updated_at) VALUES ('credential','target','credential','target','old-hash',1)",
    )
    await admin.resetUserPassword('target', 'new-password-123', actor)
    const events = stored()
    expect(events.map((event) => event.action)).toEqual([
      'BOOK_CREATED',
      'BOOK_UPDATED',
      'BOOK_STOCK_ADJUSTED',
      'BOOK_ARCHIVED',
      'BOOK_RESTORED',
      'USER_ROLE_CHANGED',
      'USER_PASSWORD_RESET',
    ])
    expect(JSON.parse(events[0].changes_json as string)).toHaveLength(7)
    expect(
      JSON.parse(events[0].changes_json as string).every(
        (change: { before: unknown }) => change.before === null,
      ),
    ).toBe(true)
    expect(JSON.parse(events[1].changes_json as string)).toEqual([
      {
        field: 'TITLE',
        before: 'Title',
        after: 'Edited',
      },
      {
        field: 'PRICE_CENTS',
        before: '100',
        after: '200',
      },
    ])
    expect(events[2].stock_delta).toBe(-2)
    expect(events[6].changes_json).toBe('[]')
    expect(JSON.stringify(events)).not.toMatch(/new-password|old-hash|@example|password_hash|token/)
  })
  it('preserves original actor and target snapshots across rename and deletion, including self-demotion role', async () => {
    const admin = createAdminRepository(db)
    const actor = await admin.getActivityActor('actor')
    await admin.setUserRole('actor', 'STAFF', actor)
    const books = createAdminBookRepository(db)
    const book = await books.create(details, 5, actor)
    db.exec(
      "UPDATE user SET name = 'Renamed' WHERE id = 'actor'; DELETE FROM user WHERE id = 'actor'",
    )
    db.prepare('DELETE FROM books WHERE id = ?').run(book.id)
    expect(stored()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actor_user_id: null,
          actor_name: 'Original actor',
          actor_role: 'ADMIN',
          target_name: 'Original actor',
        }),
        expect.objectContaining({
          target_id: String(book.id),
          target_name: 'Title',
        }),
      ]),
    )
    expect(
      (
        await createActivityRepository(db).list(
          activityInputSchema.parse({
            actorUserId: 'actor',
          }),
        )
      ).total,
    ).toBe(0)
    expect(
      (
        await createActivityRepository(db).list(
          activityInputSchema.parse({
            targetType: 'USER',
            targetId: 'actor',
          }),
        )
      ).total,
    ).toBe(1)
  })
  it('rolls back creation, metadata, stock, archive, restore and roles when event insertion fails', async () => {
    const books = createAdminBookRepository(db)
    const book = await books.create(details, 10, operatorActor)
    const archived = await books.create(
      {
        ...details,
        title: 'Archived',
      },
      10,
      operatorActor,
    )
    await books.archive(String(archived.id), true, operatorActor)
    const before = db.prepare('SELECT * FROM books').all()
    db.exec(
      "CREATE TRIGGER reject_activity BEFORE INSERT ON activity_events BEGIN SELECT RAISE(ABORT, 'Activity unavailable'); END",
    )
    for (const write of [
      async () => await books.create(details, 10, operatorActor),
      async () =>
        await books.update(
          String(book.id),
          {
            ...details,
            priceCents: 999,
          },
          operatorActor,
        ),
      async () => await books.adjustStock(String(book.id), 3, operatorActor),
      async () => await books.archive(String(book.id), true, operatorActor),
      async () => await books.archive(String(archived.id), false, operatorActor),
      async () => await createAdminRepository(db).setAdminAccess('target', true, operatorActor),
    ]) {
      await expect(write()).rejects.toThrow('Activity unavailable')
      expect(db.prepare('SELECT * FROM books').all()).toEqual(before)
      expect(await createAdminRepository(db).getUserRole('target')).toBe('CUSTOMER')
    }
    expect(stored()).toHaveLength(3)
  })
  it('rolls back password credential and session revocation when event insertion fails', async () => {
    db.exec(
      "INSERT INTO account (id, account_id, provider_id, user_id, password, updated_at) VALUES ('credential','target','credential','target','original-hash',1); INSERT INTO session (id, expires_at, token, updated_at, user_id) VALUES ('saved',2000000000000,'secret-token',1,'target'); CREATE TRIGGER reject_activity BEFORE INSERT ON activity_events BEGIN SELECT RAISE(ABORT, 'Activity unavailable'); END",
    )
    const credentials = db.prepare('SELECT * FROM account').all()
    const sessions = db.prepare('SELECT * FROM session').all()
    await expect(
      createAdminRepository(db).resetUserPassword('target', 'new-password-123', operatorActor),
    ).rejects.toThrow('Activity unavailable')
    expect(db.prepare('SELECT * FROM account').all()).toEqual(credentials)
    expect(db.prepare('SELECT * FROM session').all()).toEqual(sessions)
    expect(stored()).toEqual([])
  })
})
describe('activity API', () => {
  let db: ReturnType<typeof createDatabase>, app: Awaited<ReturnType<typeof createApp>>
  let admin: string[],
    staff: string[],
    customer: string[],
    adminId: string,
    staffId: string,
    customerId: string
  beforeEach(async () => {
    db = createDatabase(':memory:')
    seedBooks(db)
    app = await createApp(db, options, {
      provider: new FakePaymentProvider(),
    })
    for (const role of ['admin', 'staff', 'customer']) {
      const response = await request(app)
        .post('/api/auth/sign-up/email')
        .set('Origin', options.frontendOrigin)
        .send({
          name: role,
          email: `${role}@example.com`,
          password: 'activity-password-123',
        })
      expect(response.status).toBe(200)
      const cookies = response.headers['set-cookie'] as string[]
      if (role === 'admin') {
        admin = cookies
        adminId = response.body.user.id
      }
      if (role === 'staff') {
        staff = cookies
        staffId = response.body.user.id
      }
      if (role === 'customer') {
        customer = cookies
        customerId = response.body.user.id
      }
      if (role !== 'customer')
        db.prepare('INSERT INTO user_roles VALUES (?,?)').run(
          response.body.user.id,
          role.toUpperCase(),
        )
    }
  })
  afterEach(() => db.close())
  const gql = (query: string, auth = admin, variables = {}) => {
    const req = request(app).post('/graphql').set('Origin', options.frontendOrigin)
    if (auth.length) req.set('Cookie', auth)
    return req.send({
      query,
      variables,
    })
  }
  const history =
    '{ adminActivity { total items { id actorUserId actorName actorRole source action targetType targetId targetName changes { field before after } stockDelta createdAt } } }'
  it('captures committed before/after values across concurrent stock and price requests', async () => {
    const created = await gql(
      'mutation($input:CreateBookInput!){createBook(input:$input){id}}',
      staff,
      {
        input: {
          details,
          stock: 5,
        },
      },
    )
    const id = created.body.data.createBook.id
    const responses = await Promise.all([
      gql(`mutation{adjustBookStock(id:"${id}",delta:2){id}}`, staff),
      gql(`mutation{adjustBookStock(id:"${id}",delta:3){id}}`, staff),
      gql(
        'mutation($id:ID!,$input:AdminBookDetailsInput!){updateBook(id:$id,input:$input){id}}',
        staff,
        {
          id,
          input: {
            ...details,
            priceCents: 200,
          },
        },
      ),
      gql(
        'mutation($id:ID!,$input:AdminBookDetailsInput!){updateBook(id:$id,input:$input){id}}',
        staff,
        {
          id,
          input: {
            ...details,
            priceCents: 300,
          },
        },
      ),
    ])
    for (const response of responses) expect(response.body.errors).toBeUndefined()
    const page = (await gql(history)).body.data.adminActivity
    expect(page.total).toBe(5)
    const values: Record<string, string> = {
      STOCK: '5',
      PRICE_CENTS: '100',
    }
    for (const event of [...page.items].reverse().slice(1)) {
      for (const change of event.changes) {
        expect(change.before).toBe(values[change.field])
        values[change.field] = change.after
      }
    }
    expect(values.STOCK).toBe('10')
    expect(db.prepare('SELECT stock,price_cents FROM books WHERE id = ?').get(id)).toEqual({
      stock: 10,
      price_cents: Number(values.PRICE_CENTS),
    })
  })
  it('captures Staff attribution, combined price edit, manual stock and excludes checkout or rejected changes', async () => {
    const created = await gql(
      'mutation($input:CreateBookInput!){createBook(input:$input){id}}',
      staff,
      {
        input: {
          details,
          stock: 5,
        },
      },
    )
    const id = created.body.data.createBook.id
    await gql(
      'mutation($id:ID!,$input:AdminBookDetailsInput!){updateBook(id:$id,input:$input){id}}',
      staff,
      {
        id,
        input: {
          ...details,
          priceCents: 234,
          title: 'Changed',
        },
      },
    )
    await gql(`mutation{adjustBookStock(id:"${id}",delta:-1){id}}`, staff)
    await gql(`mutation{setBookArchived(id:"${id}",archived:true){id}}`, staff)
    await gql(
      `mutation{createCheckout(input:{requestKey:"${randomUUID()}",items:[{bookId:"${id}",quantity:1}]}){order{id}}}`,
      customer,
    )
    const result = (await gql(history)).body.data.adminActivity
    expect(result.total).toBe(3)
    expect(result.items[0]).toMatchObject({
      actorUserId: staffId,
      actorName: 'staff',
      actorRole: 'STAFF',
      source: 'GRAPHQL',
      action: 'BOOK_STOCK_ADJUSTED',
      stockDelta: -1,
    })
    expect(result.items[1].changes.map((c: { field: string }) => c.field)).toEqual([
      'TITLE',
      'PRICE_CENTS',
    ])
    expect(db.prepare('SELECT stock FROM books WHERE id = ?').get(id)).toEqual({
      stock: 3,
    })
  })
  it('enforces Admin permission for aliases and mixed operations before validation and after self-demotion', async () => {
    for (const [auth, code] of [
      [[], 'UNAUTHENTICATED'],
      [staff, 'FORBIDDEN'],
      [customer, 'FORBIDDEN'],
    ] as const) {
      for (const query of [
        '{ hidden:adminActivity(from:"invalid",limit:51){total} }',
        '{ viewer{role} hidden:adminActivity(targetId:" "){total} }',
      ])
        expect((await gql(query, [...auth])).body.errors[0].extensions.code).toBe(code)
    }
    await gql(`mutation{setUserRole(userId:"${adminId}",role:STAFF){id}}`)
    expect((await gql(history)).body.errors[0].extensions.code).toBe('FORBIDDEN')
    const event = db.prepare('SELECT actor_role,changes_json FROM activity_events').get()
    expect(event).toEqual({
      actor_role: 'ADMIN',
      changes_json: JSON.stringify([
        {
          field: 'ROLE',
          before: 'ADMIN',
          after: 'STAFF',
        },
      ]),
    })
  })
  it('logs canonical and Boolean compatibility role/reset paths exactly once with explicit operator recovery', async () => {
    await gql(`mutation{setUserRole(userId:"${customerId}",role:STAFF){id}}`)
    await gql(`mutation{setUserAdminAccess(userId:"${customerId}",enabled:true){id}}`)
    await gql(`mutation{setCustomerAdminAccess(userId:"${customerId}",enabled:false){id}}`)
    await gql(`mutation{setCustomerAdminAccess(userId:"${customerId}",enabled:false){id}}`)
    for (const field of ['resetUserPassword', 'resetCustomerPassword'])
      expect(
        (
          await gql(
            `mutation{${field}(userId:"${customerId}",newPassword:"changed-password-123"){id}}`,
          )
        ).body.errors,
      ).toBeUndefined()
    await createAdminRepository(db).setAdminAccess(customerId, true, operatorActor)
    const result = (await gql(history)).body.data.adminActivity
    expect(result.total).toBe(6)
    expect(result.items[0]).toMatchObject({
      source: 'OPERATOR',
      actorUserId: null,
      actorName: 'Operator command',
      actorRole: null,
      action: 'USER_ROLE_CHANGED',
    })
    expect(
      result.items.filter((e: { action: string }) => e.action === 'USER_PASSWORD_RESET'),
    ).toHaveLength(2)
    expect(JSON.stringify(result)).not.toContain('changed-password')
  })
  it('validates UTC RFC3339 bounds and IDs and combines all filters before deterministic pagination', async () => {
    const books = createAdminBookRepository(db)
    const actor = await createAdminRepository(db).getActivityActor(adminId)
    const first = await books.create(details, 5, actor)
    await books.update(
      String(first.id),
      {
        ...details,
        priceCents: 200,
      },
      actor,
    )
    await books.adjustStock(String(first.id), 1, actor)
    await books.create(
      {
        ...details,
        title: 'Second',
      },
      5,
      operatorActor,
    )
    db.exec(
      "UPDATE activity_events SET created_at = '2026-10-05T00:00:00.000Z' WHERE id = 1; UPDATE activity_events SET created_at = '2026-10-05T01:00:00.000Z' WHERE id = 2; UPDATE activity_events SET created_at = '2026-10-05T02:00:00.000Z' WHERE id IN (3,4)",
    )
    expect(
      (await gql('{adminActivity(limit:2,offset:1){total items{id}}}')).body.data.adminActivity,
    ).toEqual({
      total: 4,
      items: [
        {
          id: '3',
        },
        {
          id: '2',
        },
      ],
    })
    const filtered = await gql(
      `{adminActivity(actorUserId:"${adminId}",action:BOOK_UPDATED,changedField:PRICE_CENTS,targetType:BOOK,targetId:"${first.id}",from:"2026-10-05T01:00:00+00:00",to:"2026-10-05T02:00:00Z"){total items{id}}}`,
    )
    expect(filtered.body.data.adminActivity).toEqual({
      total: 1,
      items: [
        {
          id: '2',
        },
      ],
    })
    expect(
      (await gql('{adminActivity(from:"2026-10-05T02:00:00Z"){total}}')).body.data.adminActivity
        .total,
    ).toBe(2)
    expect(
      (await gql('{adminActivity(to:"2026-10-05T02:00:00Z"){total}}')).body.data.adminActivity
        .total,
    ).toBe(2)
    expect(
      (await gql('{adminActivity(from:"2026-10-05T00:00:00.0001Z"){total}}')).body.data
        .adminActivity.total,
    ).toBe(3)
    expect(
      (await gql('{adminActivity(to:"2026-10-05T01:00:00.0001Z"){total}}')).body.data.adminActivity
        .total,
    ).toBe(2)
    expect(
      (
        await gql(
          '{adminActivity(from:"2026-10-05T01:00:00.0001Z",to:"2026-10-05T01:00:00.0002Z"){total}}',
        )
      ).body.data.adminActivity.total,
    ).toBe(0)
    expect(
      (await gql('{adminActivity(targetType:USER,targetId:"unknown"){total items{id}}}')).body.data
        .adminActivity,
    ).toEqual({
      total: 0,
      items: [],
    })
    for (const args of [
      'limit:51',
      'limit:0',
      'offset:-1',
      'targetId:"1"',
      'actorUserId:" "',
      'targetType:BOOK,targetId:" "',
      'from:"2026-02-30T00:00:00Z"',
      'from:"2026-10-05T00:00Z"',
      'from:"2026-10-05T00:00:00+04:00"',
      'from:"2026-10-05T01:00:00Z",to:"2026-10-05T01:00:00Z"',
    ])
      expect((await gql(`{adminActivity(${args}){total}}`)).body.errors[0].extensions.code).toBe(
        'BAD_USER_INPUT',
      )
  })
})
it('denies activity to guests before validating filters', async () => {
  const db = createDatabase(':memory:')
  try {
    const app = await createApp(db, {
      frontendOrigin: 'http://localhost:5173',
      authBaseURL: 'http://localhost:5173',
      authSecret: 'activity-secret-at-least-thirty-two-characters',
    })
    const result = await request(app).post('/graphql').send({
      query: '{ adminActivity(limit: 51, from: "invalid") { total } }',
    })
    expect(result.body.errors[0].extensions.code).toBe('UNAUTHENTICATED')
  } finally {
    db.close()
  }
})
