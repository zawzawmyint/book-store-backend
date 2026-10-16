import { strictEqual, deepEqual, ok, rejects } from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import type { DatabaseHandle } from '../src/database/runtime.js'
import { normalizeStore } from '../src/database/persistence.js'
import { createAuth } from '../src/auth.js'
import { createEmailCrypto } from '../src/modules/email/email-payload.crypto.js'
import { createEmailOutboxWriter } from '../src/modules/email/email-outbox.writer.js'
import { createEmailNotificationRepository } from '../src/modules/email/email-notification.repository.js'
import { createAdminOrderRepository } from '../src/modules/orders/admin-order.repository.js'
import { deliveryAddress } from '../test/delivery-fixtures.js'

export async function verifyPostgreSQLEmailMigration(url: string, directory: string) {
  const source = resolve('drizzle/postgresql')
  const folder = join(directory, 'pre-email-migrations')
  await mkdir(join(folder, 'meta'), { recursive: true })
  const journal = JSON.parse(await readFile(join(source, 'meta/_journal.json'), 'utf8'))
  let emailIndex = -1
  for (let index = 0; index < journal.entries.length; index++) {
    if (
      (await readFile(join(source, `${journal.entries[index].tag}.sql`), 'utf8')).includes(
        'CREATE TABLE "email_notifications"',
      )
    ) {
      emailIndex = index
      break
    }
  }
  ok(emailIndex > 0, 'Email migration must be additive')
  const entries = journal.entries.slice(0, emailIndex)
  for (const entry of entries)
    await copyFile(join(source, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }))
  const pool = new Pool({ connectionString: url, max: 2 })
  try {
    await migrate(drizzle(pool), { migrationsFolder: folder })
    await pool.query(`INSERT INTO "user"(id,name,email) VALUES('email-saved','Saved','email-saved@example.com');
      INSERT INTO orders(id,user_id,customer_name,email,subtotal_cents,delivery_fee_cents,total_cents) OVERRIDING SYSTEM VALUE VALUES(19,'email-saved','Saved','email-saved@example.com',100,500,600);`)
    const before = (await pool.query('SELECT * FROM orders WHERE id=19')).rows
    const userBefore = (await pool.query('SELECT * FROM "user" WHERE id=$1', ['email-saved'])).rows
    await migrate(drizzle(pool), { migrationsFolder: source })
    await migrate(drizzle(pool), { migrationsFolder: source })
    deepEqual((await pool.query('SELECT * FROM orders WHERE id=19')).rows, before)
    deepEqual(
      (await pool.query('SELECT * FROM "user" WHERE id=$1', ['email-saved'])).rows,
      userBefore,
    )
    strictEqual(
      (await pool.query('SELECT count(*)::int AS n FROM email_notifications')).rows[0].n,
      0,
    )
    console.log('PostgreSQL email migration preserves populated accounts/orders without backfill')
  } finally {
    await pool.end()
  }
}

export async function verifyPostgreSQLEmailParity(database: DatabaseHandle) {
  if (database.provider !== 'postgresql')
    throw new Error('Email parity requires disposable PostgreSQL')
  const store = normalizeStore(database)
  const crypto = createEmailCrypto({
    keys: { v1: Buffer.alloc(32, 7).toString('base64') },
    activeKeyId: 'v1',
    dedupeKey: Buffer.alloc(32, 8).toString('base64'),
  })
  const now = Date.now()
  const writer = createEmailOutboxWriter(database, crypto, () => now)
  const repository = createEmailNotificationRepository(database, crypto, () => now)
  const userId = `email-parity-${randomUUID()}`
  const email = `${randomUUID()}@example.com`
  await database.pool.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)', [
    userId,
    'Email parity',
    email,
  ])
  const order = await store.createOrder({
    userId,
    customerName: 'Email parity',
    email,
    subtotalCents: 100,
    deliveryFeeCents: 0,
    totalCents: 100,
    paymentStatus: 'PAID',
    paymentRequired: true,
  })
  try {
    await rejects(
      store.transaction(async (tx) => {
        await tx.updateOrder(order.id, { status: 'SHIPPED' })
        await writer.writeOrderEmail(tx, order.id, 'ORDER_SHIPPED')
        throw new Error('injected transaction failure')
      }),
      /injected transaction failure/,
    )
    strictEqual((await store.order(order.id))?.status, 'SUBMITTED')
    strictEqual(
      (
        await database.pool.query(
          'SELECT count(*)::int AS n FROM email_notifications WHERE order_id=$1',
          [order.id],
        )
      ).rows[0].n,
      0,
    )
    const id = await store.transaction((tx) =>
      writer.writeOrderEmail(tx, order.id, 'ORDER_CONFIRMED'),
    )
    ok(id)
    strictEqual(
      await store.transaction((tx) => writer.writeOrderEmail(tx, order.id, 'ORDER_CONFIRMED')),
      id,
    )
    const persisted = await repository.get(id)
    ok(persisted)
    strictEqual(typeof persisted.createdAt, 'number')
    strictEqual(persisted.createdAt, now)
    strictEqual(crypto.open(persisted).order?.totalCents, 100)
    await repository.assertKeysAvailable(['v1'])
    await rejects(repository.assertKeysAvailable(['v2']), /EMAIL_PAYLOAD_KEY_UNAVAILABLE/)
    const tokens = [randomUUID(), randomUUID()]
    const claims = await Promise.all(
      tokens.map((token) => repository.claimDispatch(id, now, token)),
    )
    strictEqual(claims.filter(Boolean).length, 1, 'Only one concurrent dispatcher owns the lease')
    const winner = claims.find(Boolean)!
    strictEqual(await repository.markEnqueued(id, randomUUID(), now), false)
    const sendToken = randomUUID()
    ok(await repository.claimSend(id, now, sendToken))
    strictEqual(
      await repository.markEnqueued(id, winner.leaseToken!, now),
      false,
      'Dispatch ack cannot overwrite the send claim',
    )
    strictEqual((await repository.get(id))?.status, 'SENDING')
    await repository.recover(now + 60001)
    strictEqual((await repository.get(id))?.status, 'UNCERTAIN')
    strictEqual(typeof (await repository.get(id))?.terminalAt, 'number')
    strictEqual(await repository.claimSend(id, now + 60002, randomUUID()), undefined)

    const adminOrders = createAdminOrderRepository(database, writer.writeOrderEmail)
    await store.insertDelivery({ orderId: order.id, ...deliveryAddress })
    const preparation = {
      id: String(order.id),
      expectedStatus: 'SUBMITTED' as const,
      status: 'PREPARING' as const,
    }
    const actor = {
      source: 'GRAPHQL' as const,
      userId,
      name: 'Email parity',
      role: 'ADMIN' as const,
    }
    await adminOrders.setStatus(preparation, actor)
    await adminOrders.setStatus(preparation, actor)
    const acceptance = (await store.dueEmailNotifications(now + 60002, 50)).filter(
      (row) => row.orderId === order.id && row.kind === 'ORDER_ACCEPTED',
    )
    strictEqual(acceptance.length, 1)
    strictEqual(acceptance[0].sequence, 2)
    strictEqual(crypto.open(acceptance[0]).order?.totalCents, 100)

    const authOptions = {
      authBaseURL: 'http://localhost:4000',
      frontendOrigin: 'http://localhost:5173',
      authSecret: 'postgresql-email-parity-secret-at-least-thirty-two-characters',
    }
    const captured: { id: string; token: string; kind: string; url: string }[] = []
    const auth = createAuth(database, {
      ...authOptions,
      enqueueAuthEmail: async (input) => {
        captured.push({
          id: await writer.enqueueAuthEmail(input),
          token: input.token,
          kind: input.kind,
          url: input.url,
        })
      },
    })
    const authEmail = `${randomUUID()}@example.com`
    const post = (path: string, body: object) =>
      auth.handler(
        new Request(`${authOptions.authBaseURL}/api/auth/${path}`, {
          method: 'POST',
          headers: { origin: authOptions.frontendOrigin, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      )
    try {
      strictEqual(
        (
          await post('sign-up/email', {
            name: 'Auth parity',
            email: authEmail,
            password: 'correct-horse-battery-staple',
          })
        ).status,
        200,
      )
      strictEqual(captured[0]?.kind, 'VERIFY_EMAIL')
      const verify = (await repository.get(captured[0]!.id))!
      strictEqual(
        verify.expiresAt,
        JSON.parse(Buffer.from(captured[0]!.token.split('.')[1], 'base64url').toString()).exp *
          1000,
      )
      strictEqual(
        await writer.enqueueAuthEmail({
          kind: 'VERIFY_EMAIL',
          userId: verify.userId!,
          to: authEmail,
          token: captured[0]!.token,
          url: captured[0]!.url,
        }),
        verify.id,
      )
      strictEqual((await auth.handler(new Request(captured[0]!.url))).status, 302)
      strictEqual(await repository.authEligible(verify, crypto.open(verify)), false)
      strictEqual((await post('request-password-reset', { email: authEmail })).status, 200)
      const reset = captured.at(-1)!
      strictEqual(reset.kind, 'RESET_PASSWORD')
      const row = (await repository.get(reset.id))!
      const stored = (
        await database.pool.query('SELECT expires_at FROM verification WHERE identifier=$1', [
          `reset-password:${reset.token}`,
        ])
      ).rows[0]
      strictEqual(row.expiresAt, new Date(stored.expires_at).getTime())
      strictEqual(await store.emailResetValid(reset.token, row.userId!, now), true)
      strictEqual(
        (
          await post('reset-password', {
            token: reset.token,
            newPassword: 'replacement-password-123',
          })
        ).status,
        200,
      )
      strictEqual(await store.emailResetValid(reset.token, row.userId!, now), false)
    } finally {
      await auth.closeMail()
    }
    console.log(
      'PostgreSQL email parity: atomic rollback, dedupe, claims, leases, recovery, framework auth URLs and exact expiry passed',
    )
  } finally {
    // Only disposable parity fixtures; contract suite owns its own account resets.
    await database.pool.query('DELETE FROM email_notifications')
  }
}
