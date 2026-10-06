import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { user } from './auth-schema.js'

export { user, session, account, verification } from './auth-schema.js'

export const activityEvents = sqliteTable(
  'activity_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    actorName: text('actor_name').notNull(),
    actorRole: text('actor_role', { enum: ['CUSTOMER', 'STAFF', 'ADMIN'] }),
    source: text('source', { enum: ['GRAPHQL', 'OPERATOR'] }).notNull(),
    action: text('action', {
      enum: [
        'BOOK_CREATED',
        'BOOK_UPDATED',
        'BOOK_STOCK_ADJUSTED',
        'BOOK_ARCHIVED',
        'BOOK_RESTORED',
        'USER_ROLE_CHANGED',
        'USER_PASSWORD_RESET',
      ],
    }).notNull(),
    targetType: text('target_type', { enum: ['BOOK', 'USER'] }).notNull(),
    targetId: text('target_id').notNull(),
    targetName: text('target_name').notNull(),
    changesJson: text('changes_json').notNull(),
    stockDelta: integer('stock_delta'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (table) => [
    index('activity_newest_idx').on(table.id),
    index('activity_target_idx').on(table.targetType, table.targetId, table.id),
    index('activity_actor_idx').on(table.actorUserId, table.id),
  ],
)

export const userRoles = sqliteTable(
  'user_roles',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['CUSTOMER', 'STAFF', 'ADMIN'] }).notNull(),
  },
  (table) => [check('user_roles_valid_role', sql`${table.role} IN ('CUSTOMER', 'STAFF', 'ADMIN')`)],
)

export const books = sqliteTable(
  'books',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    title: text('title').notNull(),
    author: text('author').notNull(),
    genre: text('genre').notNull(),
    description: text('description').notNull(),
    priceCents: integer('price_cents').notNull(),
    stock: integer('stock').notNull(),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [
    check('books_price_nonnegative', sql`${table.priceCents} >= 0`),
    check('books_stock_nonnegative', sql`${table.stock} >= 0`),
    check('books_archived_boolean', sql`${table.archived} IN (0, 1)`),
  ],
)

export const orders = sqliteTable(
  'orders',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id').references(() => user.id),
    customerName: text('customer_name').notNull(),
    email: text('email').notNull(),
    totalCents: integer('total_cents').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    check('orders_total_nonnegative', sql`${table.totalCents} >= 0`),
    index('orders_user_created_idx').on(table.userId, table.createdAt),
  ],
)

export const orderItems = sqliteTable(
  'order_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id),
    title: text('title').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
  },
  (table) => [
    check('order_items_quantity_positive', sql`${table.quantity} > 0`),
    check('order_items_price_nonnegative', sql`${table.unitPriceCents} >= 0`),
  ],
)
