import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { user } from './auth-schema.js'

export { user, session, account, verification } from './auth-schema.js'

export const adminMemberships = sqliteTable('admin_memberships', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
})

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
