import { sql, type SQL } from 'drizzle-orm'
import type { DomainStore, InAppAccess, InAppNotificationRow } from './store.types.js'
const columns = {
  id: 'id',
  eventKey: 'event_key',
  recipientId: 'recipient_id',
  scope: 'scope',
  kind: 'kind',
  requiredRole: 'required_role',
  resourceType: 'resource_type',
  resourceId: 'resource_id',
  payload: 'payload',
  createdAt: 'created_at',
  readAt: 'read_at',
} as const
const selection = sql.join(
  Object.entries(columns).map(
    ([key, column]) => sql`${sql.identifier(column)} AS ${sql.identifier(key)}`,
  ),
  sql`, `,
)
function visible(a: InAppAccess) {
  return sql`recipient_id=${a.recipientId} AND scope=${a.scope} AND required_role IN ('VERIFIED','STAFF'${a.admin ? sql`, 'ADMIN'` : sql``})`
}
export function createInAppQueries(
  run: (q: SQL) => Promise<Record<string, unknown>[]>,
  postgres = false,
): Pick<
  DomainStore,
  | 'insertInAppNotification'
  | 'inAppRecipients'
  | 'inAppList'
  | 'inAppUnreadCount'
  | 'inAppRead'
  | 'inAppReadAll'
  | 'inAppCleanup'
> {
  const rows = async (q: SQL) => (await run(q)) as unknown as InAppNotificationRow[]
  return {
    async insertInAppNotification(values) {
      const keys = Object.keys(columns) as (keyof typeof columns)[]
      const result = await run(
        sql`INSERT INTO in_app_notifications (${sql.join(
          keys.map((k) => sql.identifier(columns[k])),
          sql`, `,
        )}) VALUES (${sql.join(
          keys.map((k) => sql`${values[k] ?? null}`),
          sql`, `,
        )}) ON CONFLICT (event_key,recipient_id,scope) DO NOTHING RETURNING id`,
      )
      return result.length > 0
    },
    async inAppRecipients(adminOnly) {
      const result = await run(
        sql`SELECT u.id FROM "user" u JOIN user_roles r ON r.user_id=u.id WHERE u.email_verified=${postgres ? true : 1} AND r.role IN (${adminOnly ? sql`'ADMIN'` : sql`'STAFF','ADMIN'`})`,
      )
      return result.map((r) => String(r.id))
    },
    async inAppList(access, first, after, unreadOnly = false) {
      return rows(
        sql`SELECT ${selection} FROM in_app_notifications WHERE ${visible(access)} ${unreadOnly ? sql`AND read_at IS NULL` : sql``} ${after ? sql`AND (created_at < ${after.createdAt} OR (created_at=${after.createdAt} AND id < ${after.id}))` : sql``} ORDER BY created_at DESC,id DESC LIMIT ${first}`,
      )
    },
    async inAppUnreadCount(access) {
      return Number(
        (
          await run(
            sql`SELECT count(*) AS total FROM in_app_notifications WHERE ${visible(access)} AND read_at IS NULL`,
          )
        )[0]?.total ?? 0,
      )
    },
    async inAppRead(access, id, now) {
      return (
        await rows(
          sql`UPDATE in_app_notifications SET read_at=coalesce(read_at,${now}) WHERE ${visible(access)} AND id=${id} RETURNING ${selection}`,
        )
      )[0]
    },
    async inAppReadAll(access, now) {
      return (
        await run(
          sql`UPDATE in_app_notifications SET read_at=${now} WHERE ${visible(access)} AND read_at IS NULL RETURNING id`,
        )
      ).length
    },
    async inAppCleanup(cutoff, limit) {
      return (
        await run(
          sql`DELETE FROM in_app_notifications WHERE id IN (SELECT id FROM in_app_notifications WHERE created_at < ${cutoff} ORDER BY created_at,id LIMIT ${Math.min(500, limit)}) RETURNING id`,
        )
      ).length
    },
  }
}
