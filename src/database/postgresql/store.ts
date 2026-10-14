import { and, count, desc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'
import * as schema from './schema.js'
import type { DomainStore } from '../store.types.js'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { textSearch, stockAdjustment, orderSearch } from '../query.helpers.js'
import { createDashboardQueries } from '../dashboard.queries.js'
export function createPostgreSQLStore(
  orm: NodePgDatabase<typeof schema>,
  scoped = false,
): DomainStore {
  return {
    async cart(userId, create = false) {
      if (create) await orm.insert(schema.accountCarts).values({ userId }).onConflictDoNothing()
      return firstRow(
        await orm
          .select()
          .from(schema.accountCarts)
          .where(eq(schema.accountCarts.userId, userId))
          .for(scoped ? 'update' : 'share'),
      )
    },
    async cartItems(userId) {
      return await orm
        .select()
        .from(schema.accountCartItems)
        .where(eq(schema.accountCartItems.userId, userId))
        .orderBy(schema.accountCartItems.bookId)
    },
    async setCartRevision(userId, revision) {
      await orm
        .update(schema.accountCarts)
        .set({ revision })
        .where(eq(schema.accountCarts.userId, userId))
    },
    async putCartItem(values) {
      await orm
        .insert(schema.accountCartItems)
        .values(values)
        .onConflictDoUpdate({
          target: [schema.accountCartItems.userId, schema.accountCartItems.bookId],
          set: { quantity: values.quantity, lineVersion: values.lineVersion },
        })
    },
    async deleteCartItem(userId, bookId) {
      await orm
        .delete(schema.accountCartItems)
        .where(
          and(
            eq(schema.accountCartItems.userId, userId),
            eq(schema.accountCartItems.bookId, bookId),
          ),
        )
    },
    async cartOperation(userId, key) {
      return firstRow(
        await orm
          .select()
          .from(schema.cartOperations)
          .where(
            and(
              eq(schema.cartOperations.userId, userId),
              eq(schema.cartOperations.requestKey, key),
            ),
          ),
      )
    },
    async insertCartOperation(values) {
      await orm.insert(schema.cartOperations).values(values)
    },
    async cartSnapshot(orderId) {
      return firstRow(
        await orm
          .select()
          .from(schema.checkoutCartSnapshots)
          .where(eq(schema.checkoutCartSnapshots.orderId, orderId)),
      )
    },
    async insertCartSnapshot(values) {
      await orm.insert(schema.checkoutCartSnapshots).values(values)
    },
    async cleanCartSnapshot(orderId, cleanedAt) {
      await orm
        .update(schema.checkoutCartSnapshots)
        .set({ cleanedAt })
        .where(eq(schema.checkoutCartSnapshots.orderId, orderId))
    },

    dashboardWorkspace: () =>
      orm.transaction(
        async (tx) =>
          createDashboardQueries(
            async <T>(query: import('drizzle-orm').SQL) => (await tx.execute(query)).rows as T[],
            'postgresql',
          ).workspace(),
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      ),
    dashboardFinance: (range) =>
      orm.transaction(
        async (tx) =>
          createDashboardQueries(
            async <T>(query: import('drizzle-orm').SQL) => (await tx.execute(query)).rows as T[],
            'postgresql',
          ).finance(range),
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      ),
    transaction: async (work) =>
      orm.transaction(async (tx) => work(createPostgreSQLStore(tx, true))),
    async book(id, lock = true) {
      const query = orm.select().from(schema.books).where(eq(schema.books.id, id))
      return firstRow(await (lock ? query.for(scoped ? 'update' : 'share') : query))
    },
    async catalog(search, limit, offset, options = {}) {
      const where = and(
        eq(schema.books.archived, false),
        textSearch(search, schema.books.title, schema.books.author, schema.books.genre),
        options.genre ? eq(schema.books.genre, options.genre) : undefined,
        options.inStockOnly ? gt(schema.books.stock, 0) : undefined,
        options.minPriceCents != null
          ? gte(schema.books.priceCents, options.minPriceCents)
          : undefined,
        options.maxPriceCents != null
          ? lte(schema.books.priceCents, options.maxPriceCents)
          : undefined,
      )
      // Match SQLite's ASCII-only lower() without inheriting PostgreSQL locale folding.
      const order =
        options.sort === 'TITLE_ASC'
          ? sql`translate(${schema.books.title}, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') COLLATE "C"`
          : options.sort === 'PRICE_ASC'
            ? schema.books.priceCents
            : options.sort === 'PRICE_DESC'
              ? desc(schema.books.priceCents)
              : schema.books.id
      return {
        total: firstRow(await orm.select({ n: count() }).from(schema.books).where(where))!.n,
        items: await orm
          .select()
          .from(schema.books)
          .where(where)
          .orderBy(order, schema.books.id)
          .limit(limit)
          .offset(offset),
      }
    },
    async genres() {
      return (
        await orm
          .selectDistinct({ genre: schema.books.genre })
          .from(schema.books)
          .where(eq(schema.books.archived, false))
          .orderBy(schema.books.genre)
      ).map((row) => row.genre)
    },
    async adminBooks(input) {
      const where = and(
        input.filter === 'ALL' ? undefined : eq(schema.books.archived, input.filter === 'ARCHIVED'),
        input.lowStockOnly ? lte(schema.books.stock, 5) : undefined,
        textSearch(input.search, schema.books.title, schema.books.author, schema.books.genre),
      )
      return {
        total: firstRow(await orm.select({ n: count() }).from(schema.books).where(where))!.n,
        items: await orm
          .select()
          .from(schema.books)
          .where(where)
          .orderBy(schema.books.id)
          .limit(input.limit)
          .offset(input.offset),
      }
    },
    async createBook(values) {
      return firstRow(await orm.insert(schema.books).values(values).returning())!
    },
    async updateBook(id, values) {
      return firstRow(
        await orm.update(schema.books).set(values).where(eq(schema.books.id, id)).returning(),
      )
    },
    async adjustStock(id, delta) {
      const { next, bounds } = stockAdjustment(schema.books.stock, delta)
      return firstRow(
        await orm
          .update(schema.books)
          .set({ stock: next })
          .where(and(eq(schema.books.id, id), bounds))
          .returning(),
      )
    },
    async delivery(id) {
      return firstRow(
        await orm
          .select()
          .from(schema.orderDeliveries)
          .where(eq(schema.orderDeliveries.orderId, id)),
      )
    },
    async insertDelivery(values) {
      await orm.insert(schema.orderDeliveries).values(values)
    },
    async updateDelivery(id, values) {
      await orm
        .update(schema.orderDeliveries)
        .set(values)
        .where(eq(schema.orderDeliveries.orderId, id))
    },
    async order(id) {
      return firstRow(
        await orm
          .select()
          .from(schema.orders)
          .where(eq(schema.orders.id, id))
          .for(scoped ? 'update' : 'share'),
      )
    },
    async orderBySession(id) {
      return firstRow(
        await orm
          .select()
          .from(schema.orders)
          .where(eq(schema.orders.stripeSessionId, id))
          .for(scoped ? 'update' : 'share'),
      )
    },
    async orderByRefund(id) {
      return firstRow(
        await orm
          .select()
          .from(schema.orders)
          .where(eq(schema.orders.stripeRefundId, id))
          .for(scoped ? 'update' : 'share'),
      )
    },
    async createOrder(values) {
      return firstRow(await orm.insert(schema.orders).values(values).returning())!
    },
    async updateOrder(id, values, status) {
      return firstRow(
        await orm
          .update(schema.orders)
          .set(values)
          .where(
            and(eq(schema.orders.id, id), status ? eq(schema.orders.status, status) : undefined),
          )
          .returning(),
      )
    },
    async orderPage(limit, offset, userId, status, search = '') {
      const where = and(
        userId ? eq(schema.orders.userId, userId) : undefined,
        status ? eq(schema.orders.status, status) : undefined,
        orderSearch(search, schema.orders.id, schema.orders.customerName, schema.orders.email),
      )
      return {
        total: firstRow(await orm.select({ n: count() }).from(schema.orders).where(where))!.n,
        items: await orm
          .select()
          .from(schema.orders)
          .where(where)
          .orderBy(desc(schema.orders.createdAt), desc(schema.orders.id))
          .limit(limit)
          .offset(offset),
      }
    },
    async lines(ids) {
      return ids.length
        ? await orm
            .select()
            .from(schema.orderItems)
            .where(inArray(schema.orderItems.orderId, ids))
            .orderBy(schema.orderItems.id)
        : []
    },
    async insertLine(values) {
      await orm.insert(schema.orderItems).values(values)
    },
    async history(id) {
      return await orm
        .select()
        .from(schema.orderStatusEvents)
        .where(eq(schema.orderStatusEvents.orderId, id))
        .orderBy(schema.orderStatusEvents.id)
    },
    async insertHistory(values) {
      await orm.insert(schema.orderStatusEvents).values(values)
    },
    async role(id) {
      return (
        firstRow(await orm.select().from(schema.userRoles).where(eq(schema.userRoles.userId, id)))
          ?.role ?? 'CUSTOMER'
      )
    },
    async setRole(id, role) {
      await orm
        .insert(schema.userRoles)
        .values({ userId: id, role })
        .onConflictDoUpdate({ target: schema.userRoles.userId, set: { role } })
    },
    async user(id) {
      return firstRow(
        await orm
          .select()
          .from(schema.user)
          .where(eq(schema.user.id, id))
          .for(scoped ? 'update' : 'share'),
      )
    },
    async users(input) {
      const where = and(
        input.search ? textSearch(input.search, schema.user.name, schema.user.email) : undefined,
        input.role === 'ALL'
          ? undefined
          : sql`coalesce(${schema.userRoles.role},'CUSTOMER') = ${input.role}`,
      )
      return {
        total: firstRow(
          await orm
            .select({ n: count() })
            .from(schema.user)
            .leftJoin(schema.userRoles, eq(schema.userRoles.userId, schema.user.id))
            .where(where),
        )!.n,
        items: await orm
          .select({
            id: schema.user.id,
            name: schema.user.name,
            email: schema.user.email,
            emailVerified: schema.user.emailVerified,
            createdAt: schema.user.createdAt,
            role: schema.userRoles.role,
          })
          .from(schema.user)
          .leftJoin(schema.userRoles, eq(schema.userRoles.userId, schema.user.id))
          .where(where)
          .orderBy(desc(schema.user.createdAt), desc(schema.user.id))
          .limit(input.limit)
          .offset(input.offset),
      }
    },
    async credential(id) {
      return firstRow(
        await orm
          .select()
          .from(schema.account)
          .where(and(eq(schema.account.userId, id), eq(schema.account.providerId, 'credential'))),
      )
    },
    async password(id, hash) {
      return (
        (
          await orm
            .update(schema.account)
            .set({ password: hash, updatedAt: new Date() })
            .where(eq(schema.account.id, id))
            .returning()
        ).length === 1
      )
    },
    async revokeSessions(id) {
      await orm.delete(schema.session).where(eq(schema.session.userId, id))
    },
    async insertActivity(values) {
      await orm.insert(schema.activityEvents).values(values)
    },
    async activity(input) {
      const activityEvents = schema.activityEvents
      const where = and(
        input.actorUserId ? eq(activityEvents.actorUserId, input.actorUserId) : undefined,
        input.action ? eq(activityEvents.action, input.action) : undefined,
        input.targetType ? eq(activityEvents.targetType, input.targetType) : undefined,
        input.targetId ? eq(activityEvents.targetId, input.targetId) : undefined,
        input.from ? gte(activityEvents.createdAt, input.from) : undefined,
        input.to ? lt(activityEvents.createdAt, input.to) : undefined,
        input.changedField
          ? sql`exists (select 1 from jsonb_array_elements(${activityEvents.changesJson}::jsonb) entry where entry->>'field' = ${input.changedField})`
          : undefined,
      )
      return {
        total: firstRow(await orm.select({ n: count() }).from(activityEvents).where(where))!.n,
        items: await orm
          .select()
          .from(activityEvents)
          .where(where)
          .orderBy(desc(activityEvents.id))
          .limit(input.limit)
          .offset(input.offset),
      }
    },
    async checkout(id, key) {
      if (scoped) await orm.execute(sql`select pg_advisory_xact_lock(hashtext(${id + ':' + key}))`)
      return firstRow(
        await orm
          .select()
          .from(schema.checkoutRequests)
          .where(
            and(
              eq(schema.checkoutRequests.userId, id),
              eq(schema.checkoutRequests.requestKey, key),
            ),
          ),
      )
    },
    async insertCheckout(values) {
      await orm.insert(schema.checkoutRequests).values(values)
    },
    async operation(id) {
      return firstRow(
        await orm
          .select()
          .from(schema.paymentOperations)
          .where(eq(schema.paymentOperations.id, id))
          .for(scoped ? 'update' : 'share'),
      )
    },
    async checkoutOperation(id) {
      return firstRow(
        await orm
          .select()
          .from(schema.paymentOperations)
          .where(
            and(
              eq(schema.paymentOperations.orderId, id),
              eq(schema.paymentOperations.kind, 'CREATE_SESSION'),
            ),
          ),
      )
    },
    async refundOperations(id) {
      return await orm
        .select()
        .from(schema.paymentOperations)
        .where(
          and(
            eq(schema.paymentOperations.orderId, id),
            eq(schema.paymentOperations.kind, 'REFUND'),
          ),
        )
    },
    async insertOperation(values) {
      await orm.insert(schema.paymentOperations).values(values).onConflictDoNothing()
    },
    async updateOperation(id, values, token) {
      return (
        (
          await orm
            .update(schema.paymentOperations)
            .set(values)
            .where(
              and(
                eq(schema.paymentOperations.id, id),
                token ? eq(schema.paymentOperations.leaseToken, token) : undefined,
              ),
            )
            .returning()
        ).length === 1
      )
    },
    async queuedOperations(now) {
      return await orm
        .select()
        .from(schema.paymentOperations)
        .where(
          and(
            eq(schema.paymentOperations.state, 'PENDING'),
            lte(schema.paymentOperations.retryAt, now),
            lte(schema.paymentOperations.leaseUntil, now),
          ),
        )
        .limit(20)
    },
    async pendingOrders(afterId) {
      return await orm
        .select()
        .from(schema.orders)
        .where(
          and(
            eq(schema.orders.paymentRequired, true),
            sql`${schema.orders.id} > ${afterId}`,
            or(
              inArray(schema.orders.paymentStatus, ['PENDING', 'REFUND_PENDING']),
              sql`${schema.orders.cancellationIntent} IS NOT NULL`,
            ),
          ),
        )
        .orderBy(schema.orders.id)
        .limit(20)
    },
    async event(id) {
      return firstRow(
        await orm
          .select()
          .from(schema.paymentEvents)
          .where(eq(schema.paymentEvents.id, id))
          .for(scoped ? 'update' : 'share'),
      )
    },
    async insertEvent(values) {
      await orm.insert(schema.paymentEvents).values(values).onConflictDoNothing()
    },
    async updateEvent(id, values) {
      await orm.update(schema.paymentEvents).set(values).where(eq(schema.paymentEvents.id, id))
    },
    async pendingEvents(id) {
      return await orm
        .select()
        .from(schema.paymentEvents)
        .where(
          and(isNull(schema.paymentEvents.processedAt), sql`${schema.paymentEvents.id} > ${id}`),
        )
        .orderBy(schema.paymentEvents.id)
        .limit(20)
    },
  }
}
function firstRow<T>(rows: T[]): T | undefined {
  return rows[0]
}
