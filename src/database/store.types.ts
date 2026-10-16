import type * as model from './schema.js'
import type { z } from 'zod'
import type { adminBooksInputSchema } from '../modules/books/book.validation.js'
import type { CatalogOptions } from '../modules/books/book.types.js'
import type { adminUsersInputSchema } from '../modules/admin/admin.validation.js'
import type { activityInputSchema } from '../modules/activity/activity.validation.js'
import type {
  DashboardRange,
  WorkspaceDashboardData,
  DashboardFinanceData,
} from '../modules/dashboard/dashboard.types.js'

// Logical records. Both physical schemas are checked against these contracts.
export type BookRow = typeof model.books.$inferSelect
export type OrderRow = typeof model.orders.$inferSelect
export type OperationRow = typeof model.paymentOperations.$inferSelect
export type EventRow = typeof model.paymentEvents.$inferSelect
export type NotificationRow = typeof model.emailNotifications.$inferSelect
export type NotificationDraft = typeof model.emailNotifications.$inferInsert
export type Role = 'CUSTOMER' | 'STAFF' | 'ADMIN'
export interface DomainStore {
  insertEmailNotification(values: NotificationDraft): Promise<void>
  emailNotification(id: string): Promise<NotificationRow | undefined>
  emailByDedupe(key: string): Promise<NotificationRow | undefined>
  emailOrderSequence(orderId: number): Promise<number>
  dueEmailNotifications(
    now: number,
    limit: number,
    queue?: 'AUTH' | 'ORDER',
  ): Promise<NotificationRow[]>
  claimEmailDispatch(id: string, now: number, token: string): Promise<NotificationRow | undefined>
  claimEmailSend(id: string, now: number, token: string): Promise<NotificationRow | undefined>
  updateEmailNotification(
    id: string,
    values: Partial<NotificationRow>,
    token: string,
  ): Promise<boolean>
  recoverEmailNotifications(now: number): Promise<NotificationRow[]>
  cleanupEmailNotifications(now: number): Promise<void>
  emailResetValid(token: string, userId: string, now: number): Promise<boolean>
  emailResetExpiry(token: string): Promise<number | undefined>
  emailPayloadKeyIds(): Promise<string[]>
  cart(
    userId: string,
    create?: boolean,
  ): Promise<typeof model.accountCarts.$inferSelect | undefined>
  cartItems(userId: string): Promise<(typeof model.accountCartItems.$inferSelect)[]>
  setCartRevision(userId: string, revision: string): Promise<void>
  putCartItem(values: typeof model.accountCartItems.$inferInsert): Promise<void>
  deleteCartItem(userId: string, bookId: number): Promise<void>
  cartOperation(
    userId: string,
    key: string,
  ): Promise<typeof model.cartOperations.$inferSelect | undefined>
  insertCartOperation(values: typeof model.cartOperations.$inferInsert): Promise<void>
  cartSnapshot(
    orderId: number,
  ): Promise<typeof model.checkoutCartSnapshots.$inferSelect | undefined>
  insertCartSnapshot(
    values: typeof model.checkoutCartSnapshots.$inferInsert & { orderId: number },
  ): Promise<void>
  cleanCartSnapshot(orderId: number, cleanedAt: string): Promise<void>

  dashboardWorkspace(): Promise<WorkspaceDashboardData>
  dashboardFinance(range: DashboardRange): Promise<DashboardFinanceData>
  transaction<T>(work: (store: DomainStore) => Promise<T>): Promise<T>
  book(id: number, lock?: boolean): Promise<BookRow | undefined>
  catalog(
    search: string,
    limit: number,
    offset: number,
    options?: CatalogOptions,
  ): Promise<{ total: number; items: BookRow[] }>
  genres(): Promise<string[]>
  adminBooks(
    input: z.infer<typeof adminBooksInputSchema>,
  ): Promise<{ total: number; items: BookRow[] }>
  createBook(values: typeof model.books.$inferInsert): Promise<BookRow>
  updateBook(
    id: number,
    values: Partial<typeof model.books.$inferInsert>,
  ): Promise<BookRow | undefined>
  adjustStock(id: number, delta: number): Promise<BookRow | undefined>
  delivery(id: number): Promise<typeof model.orderDeliveries.$inferSelect | undefined>
  insertDelivery(
    values: typeof model.orderDeliveries.$inferInsert & { orderId: number },
  ): Promise<void>
  updateDelivery(
    id: number,
    values: Partial<typeof model.orderDeliveries.$inferInsert>,
  ): Promise<void>
  order(id: number): Promise<OrderRow | undefined>
  orderBySession(id: string): Promise<OrderRow | undefined>
  orderByRefund(id: string): Promise<OrderRow | undefined>
  createOrder(values: typeof model.orders.$inferInsert): Promise<OrderRow>
  updateOrder(
    id: number,
    values: Partial<typeof model.orders.$inferInsert>,
    expectedStatus?: OrderRow['status'],
  ): Promise<OrderRow | undefined>
  orderPage(
    limit: number,
    offset: number,
    userId?: string,
    status?: OrderRow['status'],
    search?: string,
  ): Promise<{ total: number; items: OrderRow[] }>
  lines(ids: number[]): Promise<(typeof model.orderItems.$inferSelect)[]>
  insertLine(values: typeof model.orderItems.$inferInsert): Promise<void>
  history(id: number): Promise<(typeof model.orderStatusEvents.$inferSelect)[]>
  insertHistory(values: typeof model.orderStatusEvents.$inferInsert): Promise<void>
  role(id: string): Promise<Role>
  setRole(id: string, role: Role): Promise<void>
  user(id: string): Promise<typeof model.user.$inferSelect | undefined>
  users(input: z.infer<typeof adminUsersInputSchema>): Promise<{
    total: number
    items: {
      id: string
      name: string
      email: string
      emailVerified: boolean
      createdAt: Date
      role: Role | null
    }[]
  }>
  credential(userId: string): Promise<typeof model.account.$inferSelect | undefined>
  password(id: string, hash: string): Promise<boolean>
  revokeSessions(userId: string): Promise<void>
  insertActivity(values: typeof model.activityEvents.$inferInsert): Promise<void>
  activity(
    input: z.infer<typeof activityInputSchema>,
  ): Promise<{ total: number; items: (typeof model.activityEvents.$inferSelect)[] }>
  checkout(
    userId: string,
    key: string,
  ): Promise<typeof model.checkoutRequests.$inferSelect | undefined>
  insertCheckout(values: typeof model.checkoutRequests.$inferInsert): Promise<void>
  operation(id: string): Promise<OperationRow | undefined>
  checkoutOperation(orderId: number): Promise<OperationRow | undefined>
  refundOperations(id: number): Promise<OperationRow[]>
  insertOperation(values: typeof model.paymentOperations.$inferInsert): Promise<void>
  updateOperation(
    id: string,
    values: Partial<typeof model.paymentOperations.$inferInsert>,
    leaseToken?: string,
  ): Promise<boolean>
  queuedOperations(now: number): Promise<OperationRow[]>
  pendingOrders(afterId: number): Promise<OrderRow[]>
  event(id: string): Promise<EventRow | undefined>
  insertEvent(values: typeof model.paymentEvents.$inferInsert): Promise<void>
  updateEvent(id: string, values: Partial<typeof model.paymentEvents.$inferInsert>): Promise<void>
  pendingEvents(afterId: string): Promise<EventRow[]>
}
