import { and, count, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'
import * as s from './schema.js'
import type { DomainStore } from '../store.types.js'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { textSearch, stockAdjustment } from '../query.helpers.js'
export function createPostgreSQLStore(orm: NodePgDatabase<typeof s>, scoped = false): DomainStore {
  return {
    transaction: async (work) =>
      orm.transaction(async (tx) => work(createPostgreSQLStore(tx, true))),
    async book(id) {
      return FIRST(
        await orm
          .select()
          .from(s.books)
          .where(eq(s.books.id, id))
          .for(scoped ? 'update' : 'share'),
      )
    },
    async catalog(search, limit, offset) {
      const where = and(
        eq(s.books.archived, false),
        textSearch(search, s.books.title, s.books.author, s.books.genre),
      )
      return {
        total: FIRST(await orm.select({ n: count() }).from(s.books).where(where))!.n,
        items: await orm
          .select()
          .from(s.books)
          .where(where)
          .orderBy(s.books.id)
          .limit(limit)
          .offset(offset),
      }
    },
    async genres() {
      return (
        await orm
          .selectDistinct({ genre: s.books.genre })
          .from(s.books)
          .where(eq(s.books.archived, false))
          .orderBy(s.books.genre)
      ).map((r) => r.genre)
    },
    async adminBooks(input) {
      const where = and(
        input.filter === 'ALL' ? undefined : eq(s.books.archived, input.filter === 'ARCHIVED'),
        input.lowStockOnly ? lte(s.books.stock, 5) : undefined,
        textSearch(input.search, s.books.title, s.books.author, s.books.genre),
      )
      return {
        total: FIRST(await orm.select({ n: count() }).from(s.books).where(where))!.n,
        items: await orm
          .select()
          .from(s.books)
          .where(where)
          .orderBy(s.books.id)
          .limit(input.limit)
          .offset(input.offset),
      }
    },
    async createBook(v) {
      return FIRST(await orm.insert(s.books).values(v).returning())!
    },
    async updateBook(id, v) {
      return FIRST(await orm.update(s.books).set(v).where(eq(s.books.id, id)).returning())
    },
    async adjustStock(id, delta) {
      const { next, bounds } = stockAdjustment(s.books.stock, delta)
      return FIRST(
        await orm
          .update(s.books)
          .set({ stock: next })
          .where(and(eq(s.books.id, id), bounds))
          .returning(),
      )
    },
    async order(id) {
      return FIRST(
        await orm
          .select()
          .from(s.orders)
          .where(eq(s.orders.id, id))
          .for(scoped ? 'update' : 'share'),
      )
    },
    async orderBySession(id) {
      return FIRST(
        await orm
          .select()
          .from(s.orders)
          .where(eq(s.orders.stripeSessionId, id))
          .for(scoped ? 'update' : 'share'),
      )
    },
    async orderByRefund(id) {
      return FIRST(
        await orm
          .select()
          .from(s.orders)
          .where(eq(s.orders.stripeRefundId, id))
          .for(scoped ? 'update' : 'share'),
      )
    },
    async createOrder(v) {
      return FIRST(await orm.insert(s.orders).values(v).returning())!
    },
    async updateOrder(id, v, status) {
      return FIRST(
        await orm
          .update(s.orders)
          .set(v)
          .where(and(eq(s.orders.id, id), status ? eq(s.orders.status, status) : undefined))
          .returning(),
      )
    },
    async orderPage(limit, offset, userId, status) {
      const where = and(
        userId ? eq(s.orders.userId, userId) : undefined,
        status ? eq(s.orders.status, status) : undefined,
      )
      return {
        total: FIRST(await orm.select({ n: count() }).from(s.orders).where(where))!.n,
        items: await orm
          .select()
          .from(s.orders)
          .where(where)
          .orderBy(desc(s.orders.createdAt), desc(s.orders.id))
          .limit(limit)
          .offset(offset),
      }
    },
    async lines(ids) {
      return ids.length
        ? await orm
            .select()
            .from(s.orderItems)
            .where(inArray(s.orderItems.orderId, ids))
            .orderBy(s.orderItems.id)
        : []
    },
    async insertLine(v) {
      await orm.insert(s.orderItems).values(v)
    },
    async history(id) {
      return await orm
        .select()
        .from(s.orderStatusEvents)
        .where(eq(s.orderStatusEvents.orderId, id))
        .orderBy(s.orderStatusEvents.id)
    },
    async insertHistory(v) {
      await orm.insert(s.orderStatusEvents).values(v)
    },
    async role(id) {
      return (
        FIRST(await orm.select().from(s.userRoles).where(eq(s.userRoles.userId, id)))?.role ??
        'CUSTOMER'
      )
    },
    async setRole(id, role) {
      await orm
        .insert(s.userRoles)
        .values({ userId: id, role })
        .onConflictDoUpdate({ target: s.userRoles.userId, set: { role } })
    },
    async user(id) {
      return FIRST(
        await orm
          .select()
          .from(s.user)
          .where(eq(s.user.id, id))
          .for(scoped ? 'update' : 'share'),
      )
    },
    async users(input) {
      const where = and(
        input.search ? textSearch(input.search, s.user.name, s.user.email) : undefined,
        input.role === 'ALL'
          ? undefined
          : sql`coalesce(${s.userRoles.role},'CUSTOMER') = ${input.role}`,
      )
      return {
        total: FIRST(
          await orm
            .select({ n: count() })
            .from(s.user)
            .leftJoin(s.userRoles, eq(s.userRoles.userId, s.user.id))
            .where(where),
        )!.n,
        items: await orm
          .select({
            id: s.user.id,
            name: s.user.name,
            email: s.user.email,
            createdAt: s.user.createdAt,
            role: s.userRoles.role,
          })
          .from(s.user)
          .leftJoin(s.userRoles, eq(s.userRoles.userId, s.user.id))
          .where(where)
          .orderBy(desc(s.user.createdAt), desc(s.user.id))
          .limit(input.limit)
          .offset(input.offset),
      }
    },
    async credential(id) {
      return FIRST(
        await orm
          .select()
          .from(s.account)
          .where(and(eq(s.account.userId, id), eq(s.account.providerId, 'credential'))),
      )
    },
    async password(id, hash) {
      return (
        (
          await orm
            .update(s.account)
            .set({ password: hash, updatedAt: new Date() })
            .where(eq(s.account.id, id))
            .returning()
        ).length === 1
      )
    },
    async revokeSessions(id) {
      await orm.delete(s.session).where(eq(s.session.userId, id))
    },
    async insertActivity(v) {
      await orm.insert(s.activityEvents).values(v)
    },
    async activity(input) {
      const e = s.activityEvents
      const where = and(
        input.actorUserId ? eq(e.actorUserId, input.actorUserId) : undefined,
        input.action ? eq(e.action, input.action) : undefined,
        input.targetType ? eq(e.targetType, input.targetType) : undefined,
        input.targetId ? eq(e.targetId, input.targetId) : undefined,
        input.from ? gte(e.createdAt, input.from) : undefined,
        input.to ? lt(e.createdAt, input.to) : undefined,
        input.changedField
          ? sql`exists (select 1 from jsonb_array_elements(${e.changesJson}::jsonb) entry where entry->>'field' = ${input.changedField})`
          : undefined,
      )
      return {
        total: FIRST(await orm.select({ n: count() }).from(e).where(where))!.n,
        items: await orm
          .select()
          .from(e)
          .where(where)
          .orderBy(desc(e.id))
          .limit(input.limit)
          .offset(input.offset),
      }
    },
    async checkout(id, key) {
      if (scoped) await orm.execute(sql`select pg_advisory_xact_lock(hashtext(${id + ':' + key}))`)
      return FIRST(
        await orm
          .select()
          .from(s.checkoutRequests)
          .where(and(eq(s.checkoutRequests.userId, id), eq(s.checkoutRequests.requestKey, key))),
      )
    },
    async insertCheckout(v) {
      await orm.insert(s.checkoutRequests).values(v)
    },
    async operation(id) {
      return FIRST(
        await orm
          .select()
          .from(s.paymentOperations)
          .where(eq(s.paymentOperations.id, id))
          .for(scoped ? 'update' : 'share'),
      )
    },
    async refundOperations(id) {
      return await orm
        .select()
        .from(s.paymentOperations)
        .where(and(eq(s.paymentOperations.orderId, id), eq(s.paymentOperations.kind, 'REFUND')))
    },
    async insertOperation(v) {
      await orm.insert(s.paymentOperations).values(v).onConflictDoNothing()
    },
    async updateOperation(id, v, token) {
      return (
        (
          await orm
            .update(s.paymentOperations)
            .set(v)
            .where(
              and(
                eq(s.paymentOperations.id, id),
                token ? eq(s.paymentOperations.leaseToken, token) : undefined,
              ),
            )
            .returning()
        ).length === 1
      )
    },
    async queuedOperations(now) {
      return await orm
        .select()
        .from(s.paymentOperations)
        .where(
          and(
            eq(s.paymentOperations.state, 'PENDING'),
            lte(s.paymentOperations.retryAt, now),
            lte(s.paymentOperations.leaseUntil, now),
          ),
        )
        .limit(20)
    },
    async pendingOrders(afterId) {
      return await orm
        .select()
        .from(s.orders)
        .where(
          and(
            eq(s.orders.paymentRequired, true),
            sql`${s.orders.id} > ${afterId}`,
            or(
              inArray(s.orders.paymentStatus, ['PENDING', 'REFUND_PENDING']),
              sql`${s.orders.cancellationIntent} IS NOT NULL`,
            ),
          ),
        )
        .orderBy(s.orders.id)
        .limit(20)
    },
    async event(id) {
      return FIRST(
        await orm
          .select()
          .from(s.paymentEvents)
          .where(eq(s.paymentEvents.id, id))
          .for(scoped ? 'update' : 'share'),
      )
    },
    async insertEvent(v) {
      await orm.insert(s.paymentEvents).values(v).onConflictDoNothing()
    },
    async updateEvent(id, v) {
      await orm.update(s.paymentEvents).set(v).where(eq(s.paymentEvents.id, id))
    },
    async pendingEvents(id) {
      return await orm
        .select()
        .from(s.paymentEvents)
        .where(and(isNull(s.paymentEvents.processedAt), sql`${s.paymentEvents.id} > ${id}`))
        .orderBy(s.paymentEvents.id)
        .limit(20)
    },
  }
}
function FIRST<T>(rows: T[]): T | undefined {
  return rows[0]
}
