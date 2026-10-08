import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { user } from './auth-schema.js'

export { user, session, account, verification } from './auth-schema.js'

export const activityEvents = sqliteTable(
  'activity_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    actorName: text('actor_name').notNull(),
    actorRole: text('actor_role', { enum: ['CUSTOMER', 'STAFF', 'ADMIN'] }),
    actorType: text('actor_type', { enum: ['USER', 'SYSTEM'] })
      .notNull()
      .default('USER'),
    source: text('source', { enum: ['GRAPHQL', 'OPERATOR', 'SYSTEM'] }).notNull(),
    action: text('action', {
      enum: [
        'BOOK_CREATED',
        'BOOK_UPDATED',
        'BOOK_STOCK_ADJUSTED',
        'BOOK_ARCHIVED',
        'BOOK_RESTORED',
        'USER_ROLE_CHANGED',
        'USER_PASSWORD_RESET',
        'ORDER_STATUS_CHANGED',
        'ORDER_PAYMENT_CHANGED',
      ],
    }).notNull(),
    targetType: text('target_type', { enum: ['BOOK', 'USER', 'ORDER'] }).notNull(),
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
    subtotalCents: integer('subtotal_cents').notNull(),
    deliveryFeeCents: integer('delivery_fee_cents').notNull(),
    totalCents: integer('total_cents').notNull(),
    paymentRequired: integer('payment_required', { mode: 'boolean' }).notNull().default(true),
    paymentStatus: text('payment_status', {
      enum: ['PENDING', 'PAID', 'EXPIRED', 'REFUND_PENDING', 'REFUNDED', 'REFUND_FAILED'],
    })
      .notNull()
      .default('PENDING'),
    currency: text('currency').notNull().default('usd'),
    expiresAt: text('expires_at'),
    paidAt: text('paid_at'),
    refundedAt: text('refunded_at'),
    stripeSessionId: text('stripe_session_id'),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    stripeRefundId: text('stripe_refund_id'),
    checkoutUrl: text('checkout_url'),
    cancellationIntent: text('cancellation_intent'),
    status: text('status', {
      enum: ['SUBMITTED', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CANCELLED'],
    })
      .notNull()
      .default('SUBMITTED'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    check(
      'orders_status_valid',
      sql`${table.status} IN ('SUBMITTED', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CANCELLED')`,
    ),
    check(
      'orders_delivery_money',
      sql`${table.subtotalCents} >= 0 AND ${table.deliveryFeeCents} >= 0 AND ${table.totalCents} = ${table.subtotalCents} + ${table.deliveryFeeCents}`,
    ),
    check('orders_total_nonnegative', sql`${table.totalCents} >= 0`),
    index('orders_user_created_idx').on(table.userId, table.createdAt),
    uniqueIndex('orders_session_unique').on(table.stripeSessionId),
    uniqueIndex('orders_intent_unique').on(table.stripePaymentIntentId),
    uniqueIndex('orders_refund_unique').on(table.stripeRefundId),
    index('orders_payment_pending_idx').on(table.paymentStatus, table.expiresAt),
    check('orders_payment_required_boolean', sql`${table.paymentRequired} IN (0,1)`),
    check(
      'orders_payment_valid',
      sql`${table.paymentStatus} IN ('PENDING','PAID','EXPIRED','REFUND_PENDING','REFUNDED','REFUND_FAILED')`,
    ),
    check('orders_currency_usd', sql`${table.currency} = 'usd'`),
  ],
)

export const orderDeliveries = sqliteTable(
  'order_deliveries',
  {
    orderId: integer('order_id')
      .primaryKey()
      .notNull()
      .references(() => orders.id),
    recipientName: text('recipient_name').notNull(),
    phone: text('phone').notNull(),
    addressLine1: text('address_line1').notNull(),
    addressLine2: text('address_line2'),
    city: text('city').notNull(),
    region: text('region'),
    postalCode: text('postal_code'),
    countryCode: text('country_code').notNull(),
    carrier: text('carrier'),
    trackingNumber: text('tracking_number'),
    trackingUrl: text('tracking_url'),
    shippedAt: text('shipped_at'),
    deliveredAt: text('delivered_at'),
  },
  (t) => [
    check(
      'order_deliveries_timestamps',
      sql`${t.deliveredAt} IS NULL OR ${t.shippedAt} IS NOT NULL`,
    ),
    check(
      'order_deliveries_tracking',
      sql`(${t.trackingUrl} IS NULL OR ${t.trackingNumber} IS NOT NULL) AND (${t.trackingNumber} IS NULL OR ${t.carrier} IS NOT NULL)`,
    ),
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

export const orderStatusEvents = sqliteTable(
  'order_status_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id),
    fromStatus: text('from_status', {
      enum: ['SUBMITTED', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CANCELLED'],
    }),
    toStatus: text('to_status', {
      enum: ['SUBMITTED', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CANCELLED'],
    }).notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
    cancellationReason: text('cancellation_reason'),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    actorName: text('actor_name').notNull(),
    actorRole: text('actor_role', { enum: ['CUSTOMER', 'STAFF', 'ADMIN'] }),
    actorType: text('actor_type', { enum: ['USER', 'SYSTEM'] })
      .notNull()
      .default('USER'),
  },
  (table) => [
    index('order_status_events_order_idx').on(table.orderId, table.id),
    check(
      'order_status_events_from_valid',
      sql`${table.fromStatus} IS NULL OR ${table.fromStatus} IN ('SUBMITTED','PREPARING','SHIPPED','DELIVERED','CANCELLED')`,
    ),
    check(
      'order_status_events_to_valid',
      sql`${table.toStatus} IN ('SUBMITTED','PREPARING','SHIPPED','DELIVERED','CANCELLED')`,
    ),
    check(
      'order_status_events_role_valid',
      sql`(${table.actorType} = 'USER' AND ${table.actorRole} IN ('CUSTOMER','STAFF','ADMIN')) OR (${table.actorType} = 'SYSTEM' AND ${table.actorRole} IS NULL)`,
    ),
  ],
)

export const checkoutRequests = sqliteTable(
  'checkout_requests',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    requestKey: text('request_key').notNull(),
    linesJson: text('lines_json').notNull(),
    deliveryJson: text('delivery_json').notNull(),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id),
  },
  (table) => [
    uniqueIndex('checkout_requests_owner_key').on(table.userId, table.requestKey),
    uniqueIndex('checkout_requests_order').on(table.orderId),
  ],
)

export const paymentOperations = sqliteTable(
  'payment_operations',
  {
    id: text('id').primaryKey(),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id),
    kind: text('kind', { enum: ['CREATE_SESSION', 'REFUND'] }).notNull(),
    state: text('state', { enum: ['PENDING', 'DONE', 'FAILED', 'MANUAL'] })
      .notNull()
      .default('PENDING'),
    createdAt: integer('created_at').notNull(),
    retryAt: integer('retry_at').notNull(),
    leaseUntil: integer('lease_until').notNull().default(0),
    leaseToken: text('lease_token'),
    attempts: integer('attempts').notNull().default(0),
    safeError: text('safe_error'),
  },
  (table) => [
    index('payment_operations_due').on(table.state, table.retryAt, table.leaseUntil),
    check('payment_operations_kind', sql`${table.kind} IN ('CREATE_SESSION','REFUND')`),
    check('payment_operations_state', sql`${table.state} IN ('PENDING','DONE','FAILED','MANUAL')`),
  ],
)

export const paymentEvents = sqliteTable(
  'payment_events',
  {
    id: text('id').primaryKey(),
    resourceId: text('resource_id').notNull(),
    type: text('type').notNull(),
    receivedAt: integer('received_at').notNull(),
    processedAt: integer('processed_at'),
    safeError: text('safe_error'),
  },
  (table) => [index('payment_events_pending').on(table.processedAt)],
)
