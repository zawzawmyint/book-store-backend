import { afterEach, beforeEach, expect, it } from 'vitest'
import request from 'supertest'
import { randomUUID } from 'node:crypto'
import { createDatabase } from '../src/database/connection.js'
import { createApp } from '../src/app.js'
import { seedBooks } from '../src/database/seed.js'
import { FakePaymentProvider } from './fake-payment-provider.js'
const options = {
  frontendOrigin: 'http://localhost:5173',
  authBaseURL: 'http://localhost:4000',
  authSecret: 'payments-test-secret-at-least-thirty-two-characters',
}
let db: ReturnType<typeof createDatabase>,
  app: Awaited<ReturnType<typeof createApp>>,
  provider: FakePaymentProvider
let buyer: string[], other: string[], staff: string[], staffId: string
beforeEach(async () => {
  db = createDatabase(':memory:')
  seedBooks(db)
  provider = new FakePaymentProvider()
  app = await createApp(db, options, { provider })
  for (const name of ['buyer', 'other', 'staff']) {
    const r = await request(app)
      .post('/api/auth/sign-up/email')
      .set('Origin', options.frontendOrigin)
      .send({ name, email: `${name}@example.com`, password: 'password-long-enough-123' })
    expect(r.status).toBe(200)
    const cookies = r.headers['set-cookie'] as string[]
    if (name === 'buyer') buyer = cookies
    if (name === 'other') other = cookies
    if (name === 'staff') {
      staff = cookies
      staffId = r.body.user.id
      db.prepare("INSERT INTO user_roles VALUES (?,'STAFF')").run(staffId)
    }
  }
})
afterEach(() => db.close())
function gql(query: string, cookies: string[] = buyer) {
  const r = request(app).post('/graphql').set('Origin', options.frontendOrigin)
  if (cookies.length) r.set('Cookie', cookies)
  return r.send({ query })
}
const checkout = () =>
  gql(
    `mutation{createCheckout(input:{requestKey:"${randomUUID()}",items:[{bookId:"1",quantity:1}]}){order{id status payment{required status currency expiresAt}} checkoutUrl}}`,
  )
it('enforces authentication, owner scope and process permissions before validation', async () => {
  const c = await checkout()
  expect(c.body.errors).toBeUndefined()
  const id = c.body.data.createCheckout.order.id
  const customerOps = [
    `resumeCheckout(orderId:"${id}"){order{id}}`,
    `refreshOrderPayment(orderId:"${id}"){id}`,
  ]
  for (const operation of customerOps) {
    expect((await gql(`mutation{${operation}}`, [])).body.errors[0].extensions.code).toBe(
      'UNAUTHENTICATED',
    )
    expect((await gql(`mutation{${operation}}`, other)).body.errors[0].extensions.code).toBe(
      'BAD_USER_INPUT',
    )
  }
  expect((await gql(`{myOrder(id:"${id}"){id}}`, other)).body.data.myOrder).toBeNull()
  for (const auth of [buyer, other])
    expect(
      (await gql('mutation{retryOrderRefund(orderId:"invalid"){id}}', auth)).body.errors[0]
        .extensions.code,
    ).toBe('FORBIDDEN')
  expect(
    (await gql('mutation{retryOrderRefund(orderId:"invalid"){id}}', staff)).body.errors[0]
      .extensions.code,
  ).toBe('BAD_USER_INPUT')
  db.prepare('DELETE FROM user_roles WHERE user_id=?').run(staffId)
  expect(
    (await gql('mutation{retryOrderRefund(orderId:"invalid"){id}}', staff)).body.errors[0]
      .extensions.code,
  ).toBe('FORBIDDEN')
  expect(
    (await gql('mutation{placeOrder(input:{items:[{bookId:"1",quantity:1}]}){id}}')).body.errors[0],
  ).toMatchObject({
    message: 'Use createCheckout to place a paid order',
    extensions: { code: 'BAD_USER_INPUT' },
  })
})
it('preserves raw signed webhook bytes, size bounds, durable queuing and duplicate effects', async () => {
  const c = await checkout()
  const id = c.body.data.createCheckout.order.id,
    session = [...provider.sessions.keys()][0]
  provider.pay(session)
  const body = JSON.stringify({
    id: 'evt_signed',
    type: 'checkout.session.completed',
    resourceId: session,
  })
  expect(
    (
      await request(app)
        .post('/api/payments/stripe/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 'forged')
        .send(body)
    ).status,
  ).toBe(400)
  expect(
    (await gql(`{myOrder(id:"${id}"){payment{status}}}`)).body.data.myOrder.payment.status,
  ).toBe('PENDING')
  db.exec(
    "CREATE TRIGGER reject_provider_event BEFORE INSERT ON payment_events BEGIN SELECT RAISE(ABORT,'persistence offline'); END",
  )
  expect(
    (
      await request(app)
        .post('/api/payments/stripe/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 'valid')
        .send(body)
    ).status,
  ).toBe(503)
  db.exec('DROP TRIGGER reject_provider_event')
  provider.unavailable = true
  expect(
    (
      await request(app)
        .post('/api/payments/stripe/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 'valid')
        .send(body)
    ).status,
  ).toBe(503)
  expect(db.prepare('SELECT processed_at FROM payment_events').get()).toEqual({
    processed_at: null,
  })
  provider.unavailable = false
  for (let n = 0; n < 2; n++)
    expect(
      (
        await request(app)
          .post('/api/payments/stripe/webhook')
          .set('Content-Type', 'application/json')
          .set('stripe-signature', 'valid')
          .send(body)
      ).status,
    ).toBe(200)
  expect(
    (await gql(`{myOrder(id:"${id}"){payment{status}}}`)).body.data.myOrder.payment.status,
  ).toBe('PAID')
  expect(db.prepare('SELECT count(*) n FROM payment_events').get()).toEqual({ n: 1 })
  expect(
    (
      await request(app)
        .post('/api/payments/stripe/webhook')
        .set('Content-Type', 'application/json')
        .send('x'.repeat(102401))
    ).status,
  ).toBe(413)
})
it('disabled checkout returns a safe availability error while legacy reads remain usable', async () => {
  const disabled = await createApp(db, options)
  const r = await request(disabled)
    .post('/graphql')
    .set('Origin', options.frontendOrigin)
    .set('Cookie', buyer)
    .send({
      query: `mutation{createCheckout(input:{requestKey:"${randomUUID()}",items:[{bookId:"1",quantity:1}]}){order{id}}}`,
    })
  expect(r.body.errors[0].extensions.code).toBe('PAYMENT_UNAVAILABLE')
  expect(db.prepare('SELECT count(*) n FROM orders').get()).toEqual({ n: 0 })
})

it('rejects malformed signed event envelopes as invalid payloads instead of queue failures', async () => {
  const r = await request(app)
    .post('/api/payments/stripe/webhook')
    .set('Content-Type', 'application/json')
    .set('stripe-signature', 'valid')
    .send(JSON.stringify({ type: 'checkout.session.completed', resourceId: 'cs_bad' }))
  expect(r.status).toBe(400)
  expect(db.prepare('SELECT * FROM payment_events').all()).toEqual([])
})
