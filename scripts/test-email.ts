// Integration gate: real Redis and a loopback SMTP capture, never production recipients.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer, type Socket } from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'
import nodemailer from 'nodemailer'
import request from 'supertest'
import { createDatabase } from '../src/database/connection.js'
import { createApp } from '../src/app.js'
import { loadEmailConfig } from '../src/modules/email/email-config.js'
import { createEmailCrypto } from '../src/modules/email/email-payload.crypto.js'
import { createEmailNotificationRepository } from '../src/modules/email/email-notification.repository.js'
import { createEmailQueues } from '../src/modules/email/email-queue.js'
import { createEmailDispatcher } from '../src/modules/email/email-dispatcher.js'
import { startEmailRuntime } from '../src/modules/email/email.worker.js'
import { normalizeStore } from '../src/database/persistence.js'
import { seedBooks } from '../src/database/seed.js'
import { FakePaymentProvider } from '../test/fake-payment-provider.js'

async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address()
      assert(addr && typeof addr === 'object')
      probe.close(() => resolve(addr.port))
    })
  })
}
let redisProcess: ReturnType<typeof spawn> | undefined
let redisDirectory: string | undefined
let redisPort: number | undefined
let redisUrl = process.env.EMAIL_TEST_REDIS_URL
if (!redisUrl && process.env.EMAIL_TEST_REDIS_BINARY) {
  const port = await freePort()
  redisPort = port
  redisDirectory = await mkdtemp(join(tmpdir(), 'book-store-email-redis-'))
  redisProcess = spawn(
    process.env.EMAIL_TEST_REDIS_BINARY,
    [
      '--bind',
      '127.0.0.1',
      '--port',
      String(port),
      '--dir',
      redisDirectory,
      '--save',
      '',
      '--appendonly',
      'no',
    ],
    { stdio: 'ignore', windowsHide: true },
  )
  const startup = await new Promise<boolean>((resolve) => {
    redisProcess!.once('error', () => resolve(false))
    redisProcess!.once('exit', () => resolve(false))
    setTimeout(() => resolve(redisProcess!.exitCode === null), 750)
  })
  if (!startup) throw new Error('Email test Redis executable could not start')
  redisUrl = `redis://127.0.0.1:${port}`
}
if (!redisUrl)
  throw new Error(
    'EMAIL_TEST_REDIS_URL is required. Start compose.email.yaml Redis or supply an isolated test Redis URL.',
  )
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(redisUrl).hostname))
  throw new Error('Email acceptance tests require a loopback Redis instance')
const messages: string[] = []
const sockets = new Set<Socket>()
const smtp = createServer((socket) => {
  sockets.add(socket)
  socket.on('close', () => sockets.delete(socket))
  socket.write('220 localhost email acceptance\r\n')
  let buffer = ''
  let data = false
  let message = ''
  socket.on('data', (chunk) => {
    buffer += chunk.toString()
    let end: number
    while ((end = buffer.indexOf('\r\n')) >= 0) {
      const line = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      if (data) {
        if (line === '.') {
          data = false
          // Nodemailer wraps quoted-printable MIME lines; assert content across
          // those transport soft breaks rather than depending on line length.
          messages.push(message.replace(/=\r\n/g, ''))
          message = ''
          socket.write('250 accepted\r\n')
        } else message += line.replace(/^\.\./, '.') + '\r\n'
      } else if (/^(EHLO|HELO)/i.test(line)) socket.write('250-localhost\r\n250 8BITMIME\r\n')
      else if (/^DATA$/i.test(line)) {
        data = true
        socket.write('354 end with dot\r\n')
      } else if (/^QUIT$/i.test(line)) socket.end('221 bye\r\n')
      else socket.write('250 ok\r\n')
    }
  })
})
await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve))
const smtpAddress = smtp.address()
assert(smtpAddress && typeof smtpAddress === 'object')
const healthPort = await new Promise<number>((resolve, reject) => {
  const probe = createServer()
  probe.once('error', reject)
  probe.listen(0, '127.0.0.1', () => {
    const addr = probe.address()
    assert(addr && typeof addr === 'object')
    probe.close(() => resolve(addr.port))
  })
})
const config = loadEmailConfig(
  {
    NODE_ENV: 'test',
    EMAIL_DELIVERY_MODE: 'queued',
    EMAIL_PAYLOAD_KEYS: JSON.stringify({ test: Buffer.alloc(32, 7).toString('base64') }),
    EMAIL_PAYLOAD_ACTIVE_KEY_ID: 'test',
    REDIS_URL: redisUrl,
    EMAIL_QUEUE_PREFIX: `email-acceptance-${randomUUID()}`,
    EMAIL_WORKER_HEALTH_PORT: String(healthPort),
    EMAIL_ORDER_NOTIFICATIONS_ENABLED: 'true',
  },
  'worker',
)
const crypto = createEmailCrypto(config)
const db = createDatabase(':memory:')
seedBooks(db)
const provider = new FakePaymentProvider()
const repo = createEmailNotificationRepository(db, crypto)
const store = normalizeStore(db)
const app = await createApp(
  db,
  {
    frontendOrigin: 'http://localhost:5173',
    authBaseURL: 'http://localhost:4000',
    authSecret: 'email-acceptance-secret-at-least-thirty-two-characters',
    emailConfig: config,
  },
  { provider, deliveryEnabled: true, deliveryCountryCodes: ['US'], deliveryFeeCents: 500 },
)
const queues = createEmailQueues(config)
let stop: (() => Promise<void>) | undefined
const transport = nodemailer.createTransport({
  host: '127.0.0.1',
  port: smtpAddress.port,
  secure: false,
  ignoreTLS: true,
  connectionTimeout: 2000,
  socketTimeout: 3000,
})
const sender = {
  async send(message: { to: string; subject: string; text: string; html: string }) {
    assert(message.to.endsWith('@example.com'))
    await transport.sendMail({ from: 'acceptance@example.com', ...message })
  },
}
const post = (path: string, body: object) =>
  request(app).post(`/api/auth/${path}`).set('Origin', 'http://localhost:5173').send(body)
async function until(predicate: () => Promise<boolean>, label: string) {
  const deadline = Date.now() + 15000
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`Email integration timeout: ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
try {
  await Promise.race([
    Promise.all(Object.values(queues.queues).map((queue) => queue.waitUntilReady())),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Real Redis unavailable')), 5000).unref(),
    ),
  ])
  const credentials = { email: 'reader@example.com', password: 'correct-horse-battery-staple' }
  assert.equal((await post('sign-up/email', { name: 'Reader', ...credentials })).status, 200)
  const first = (await repo.due(Date.now(), 10, 'AUTH'))[0]
  assert(first)
  const verifyUrl = crypto.open(first).url!
  assert.equal(messages.length, 0, 'API must not submit SMTP')
  let offset = 0
  const dispatch = createEmailDispatcher(repo, queues.queues, () => Date.now() + offset)
  await dispatch()
  const queued = await queues.queues.AUTH.getJob(first.id)
  assert.deepEqual(queued?.data, { notificationId: first.id })
  await queued!.remove()
  offset = 31000
  await dispatch()
  assert(await queues.queues.AUTH.getJob(first.id), 'Missing Redis job must be recreated')
  stop = await startEmailRuntime({
    config,
    repository: repo,
    crypto,
    sender,
    frontendOrigin: 'http://localhost:5173',
  })
  await until(
    async () => (await repo.get(first.id))?.status === 'SUBMITTED',
    'verification submitted',
  )
  assert.equal(messages.length, 1)
  assert(messages[0].includes('Verify your email'))
  assert.equal((await repo.get(first.id))?.payloadCiphertext, null)
  const url = new URL(verifyUrl)
  assert.equal((await request(app).get(url.pathname + url.search)).status, 302)
  assert.equal((await post('sign-in/email', credentials)).status, 200)
  await queues.queues.AUTH.add('duplicate', { notificationId: first.id }, { jobId: randomUUID() })
  await new Promise((resolve) => setTimeout(resolve, 150))
  assert.equal(messages.length, 1, 'Repeated jobs must not resend terminal records')

  await stop()
  stop = undefined
  if (redisProcess) {
    redisProcess.kill()
    await new Promise<void>((resolve) => redisProcess!.once('exit', () => resolve()))
  }
  // Recording a reset must succeed while Redis is offline: the API only touches its outbox.
  assert.equal((await post('request-password-reset', { email: credentials.email })).status, 200)
  const reset = (await repo.due(Date.now(), 10, 'AUTH')).find(
    (row) => row.kind === 'RESET_PASSWORD',
  )!
  assert(reset)
  const resetPayload = crypto.open(reset)
  if (redisProcess) {
    redisProcess = spawn(
      process.env.EMAIL_TEST_REDIS_BINARY!,
      [
        '--bind',
        '127.0.0.1',
        '--port',
        String(redisPort),
        '--dir',
        redisDirectory!,
        '--save',
        '',
        '--appendonly',
        'no',
      ],
      { stdio: 'ignore', windowsHide: true },
    )
    await new Promise<void>((resolve, reject) => {
      redisProcess!.once('error', reject)
      setTimeout(resolve, 750)
    })
  }
  stop = await startEmailRuntime({
    config,
    repository: repo,
    crypto,
    sender,
    frontendOrigin: 'http://localhost:5173',
  })
  await until(
    async () => (await repo.get(reset.id))?.status === 'SUBMITTED',
    'reset after worker restart',
  )
  assert.equal(messages.length, 2)
  assert.equal(
    (
      await post('reset-password', {
        token: resetPayload.resetToken,
        newPassword: 'replacement-password-123',
      })
    ).status,
    200,
  )
  assert.equal(
    (
      await post('reset-password', {
        token: resetPayload.resetToken,
        newPassword: 'replacement-password-456',
      })
    ).status,
    400,
  )

  // Drive the real authenticated API -> transaction -> outbox -> Redis -> SMTP path.
  await store.setRole(first.userId!, 'ADMIN')
  const login = await post('sign-in/email', {
    email: credentials.email,
    password: 'replacement-password-123',
  })
  assert.equal(login.status, 200)
  const cookies = login.headers['set-cookie'] as string[]
  const cookie = cookies.map((value) => value.split(';')[0]).join('; ')
  async function graphql<T>(query: string, variables: object) {
    const response = await request(app)
      .post('/graphql')
      .set('Origin', 'http://localhost:5173')
      .set('Cookie', cookie)
      .send({ query, variables })
    assert.equal(response.status, 200)
    assert.equal(response.body.errors, undefined)
    return response.body.data as T
  }
  async function paidOrder() {
    const result = await graphql<{ createCheckout: { order: { id: string } } }>(
      'mutation($input:CreateCheckoutInput!){createCheckout(input:$input){order{id}}}',
      {
        input: {
          items: [{ bookId: '1', quantity: 1 }],
          requestKey: randomUUID(),
          deliveryAddress: {
            recipientName: 'Reader',
            phone: '+1 555 123 4567',
            addressLine1: '12 Main Street',
            city: 'City',
            countryCode: 'US',
          },
          expectedDeliveryFeeCents: 500,
          expectedTotalCents: 2199,
        },
      },
    )
    const id = result.createCheckout.order.id
    provider.pay([...provider.sessions.keys()].at(-1)!)
    await graphql('mutation($id:ID!){refreshOrderPayment(orderId:$id){id}}', { id })
    return id
  }
  async function setStatus(input: object) {
    await graphql(
      'mutation($input:SetOrderStatusInput!){setOrderStatus(input:$input){id status}}',
      { input },
    )
  }
  const shippedOrder = await paidOrder()
  await until(async () => messages.length >= 3, 'payment receipt from payment API')
  assert(messages[2].includes('Payment received'))
  assert(messages[2].includes('awaiting order acceptance'))
  await setStatus({ id: shippedOrder, expectedStatus: 'SUBMITTED', status: 'PREPARING' })
  await setStatus({ id: shippedOrder, expectedStatus: 'SUBMITTED', status: 'PREPARING' })
  await until(async () => messages.length >= 4, 'acceptance from staff preparation API')
  assert(messages[3].includes('Order accepted'))
  assert(messages[3].includes('preparing your books'))
  await setStatus({
    id: shippedOrder,
    expectedStatus: 'PREPARING',
    status: 'SHIPPED',
    shipment: {
      carrier: 'Acceptance Carrier',
      trackingNumber: 'T1',
      trackingUrl: 'https://carrier.example/T1',
    },
  })
  await until(async () => messages.length >= 5, 'shipment from staff API')
  const cancelledOrder = await paidOrder()
  await setStatus({
    id: cancelledOrder,
    expectedStatus: 'SUBMITTED',
    status: 'CANCELLED',
    cancellationReason: 'Acceptance cancellation',
  })
  await app.locals.payments.recover()
  await until(async () => messages.length >= 8, 'payment receipt cancellation and confirmed refund')
  assert.equal(messages.length, 8)
  assert(messages[2].includes('The Great Gatsby'))
  assert(messages[4].includes('Acceptance Carrier'))
  assert(
    messages.some((message) =>
      message.includes('Cancellation does not confirm a completed refund'),
    ),
  )
  assert(messages.some((message) => message.includes('Your full refund has been confirmed')))
  assert.equal((await fetch(`http://127.0.0.1:${healthPort}/ready`)).status, 200)
  console.log(
    JSON.stringify({
      status: 'passed',
      assertions: [
        'real Redis',
        'ID-only queue payload',
        'missing-job recovery',
        'SMTP capture',
        'verification',
        'single-use reset',
        'worker restart',
        ...(redisProcess ? ['Redis stop/restart', 'API records during Redis outage'] : []),
        'duplicate job',
        'auth/order queues',
        'authenticated payment-to-email',
        'staff acceptance email without duplicates',
        'shipment cancellation and refund emails',
        'health',
      ],
      capturedMessages: messages.length,
    }),
  )
} finally {
  await stop?.()
  for (const queue of Object.values(queues.queues))
    await queue.obliterate({ force: true }).catch(() => {})
  await queues.close()
  transport.close()
  await app.locals.close()
  db.close()
  for (const socket of sockets) socket.destroy()
  await new Promise<void>((resolve) => smtp.close(() => resolve()))
  if (redisProcess) {
    redisProcess.kill()
    await new Promise<void>((resolve) => {
      if (redisProcess!.exitCode !== null) resolve()
      else redisProcess!.once('exit', () => resolve())
    })
  }
  if (redisDirectory) {
    const target = resolvePath(redisDirectory)
    if (!target.startsWith(resolvePath(tmpdir(), 'book-store-email-redis-')))
      throw new Error('Unsafe Redis test cleanup path')
    await rm(target, { recursive: true, force: true })
  }
}
