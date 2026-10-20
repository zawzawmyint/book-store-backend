import type {
  InAppNotification,
  InAppNotificationKind,
  NotificationScope as GraphQLNotificationScope,
  NotificationResourceType,
  NotificationRefundPhase,
} from '../../graphql/generated/resolvers.js'
import { GraphQLError } from 'graphql'
import { normalizeStore, type DatabaseInput } from '../../database/persistence.js'
import type { InAppNotificationRow } from '../../database/store.types.js'
import type { NotificationPayload, NotificationScope } from './notification.types.js'
import { decodeNotificationCursor, notificationPageSchema } from './notification.validation.js'
function fail(message: string, code: string): never {
  throw new GraphQLError(message, { extensions: { code } })
}
function present(row: InAppNotificationRow): InAppNotification {
  const payload = JSON.parse(row.payload) as NotificationPayload
  return {
    ...row,
    kind: row.kind as InAppNotificationKind,
    scope: row.scope as GraphQLNotificationScope,
    resourceType: row.resourceType as NotificationResourceType,
    bookTitle: payload.bookTitle ?? null,
    stockAtEvent: payload.stockAtEvent ?? null,
    refundPhase: (payload.refundPhase as NotificationRefundPhase) ?? null,
    testPayment: payload.testPayment,
  }
}
export function createNotificationRepository(input: DatabaseInput, enabled = true) {
  const store = normalizeStore(input)
  async function authorize(userId: string, scope: NotificationScope) {
    if (!enabled) fail('Notifications are disabled', 'NOTIFICATIONS_DISABLED')
    const user = await store.user(userId)
    if (!user?.emailVerified) fail('Sign in with a verified account', 'UNAUTHENTICATED')
    const role = await store.role(userId)
    if (scope === 'WORKSPACE' && role !== 'STAFF' && role !== 'ADMIN')
      fail('Workspace access required', 'FORBIDDEN')
    return { recipientId: userId, scope, admin: role === 'ADMIN' }
  }
  return {
    authorize,
    async list(
      userId: string,
      scope: NotificationScope,
      input: { first?: number | null; after?: string | null; unreadOnly?: boolean | null },
    ) {
      const access = await authorize(userId, scope)
      const parsed = notificationPageSchema.safeParse({
        first: input.first ?? 20,
        after: input.after,
        unreadOnly: input.unreadOnly ?? false,
      })
      if (!parsed.success) fail('Invalid notification pagination', 'BAD_USER_INPUT')
      let cursor: ReturnType<typeof decodeNotificationCursor>
      try {
        cursor = decodeNotificationCursor(parsed.data.after)
      } catch {
        fail('Invalid notification cursor', 'BAD_USER_INPUT')
      }
      const rows = await store.inAppList(
        access,
        parsed.data.first + 1,
        cursor,
        parsed.data.unreadOnly,
      )
      const nodes = rows.slice(0, parsed.data.first).map(present),
        last = nodes.at(-1)
      return {
        nodes,
        pageInfo: {
          hasNextPage: rows.length > parsed.data.first,
          endCursor: last
            ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString(
                'base64url',
              )
            : null,
        },
      }
    },
    async unreadCount(userId: string, scope: NotificationScope) {
      return store.inAppUnreadCount(await authorize(userId, scope))
    },
    async read(userId: string, scope: NotificationScope, id: string) {
      const access = await authorize(userId, scope)
      const row = await store.inAppRead(access, id, new Date().toISOString())
      if (!row) fail('Notification was not found', 'BAD_USER_INPUT')
      await store.notifyInAppChange?.({ recipientId: userId, scope })
      return present(row)
    },
    async readAll(userId: string, scope: NotificationScope) {
      const changedCount = await store.inAppReadAll(
        await authorize(userId, scope),
        new Date().toISOString(),
      )
      await store.notifyInAppChange?.({ recipientId: userId, scope })
      return { changedCount }
    },
  }
}
export type NotificationRepository = ReturnType<typeof createNotificationRepository>
export async function cleanupNotifications(input: DatabaseInput, now = Date.now()) {
  const store = normalizeStore(input),
    cutoff = new Date(now - 90 * 86400000).toISOString()
  let deleted = 0,
    count = 0
  do {
    count = await store.inAppCleanup(cutoff, 500)
    deleted += count
  } while (count === 500)
  return { deleted, cutoff }
}
