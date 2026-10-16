import { sql, type SQL } from 'drizzle-orm'
import type { DomainStore, NotificationRow } from './store.types.js'

const columns = {
  id: 'id',
  dedupeKey: 'dedupe_key',
  kind: 'kind',
  queue: 'queue',
  userId: 'user_id',
  orderId: 'order_id',
  replayOfId: 'replay_of_id',
  sequence: 'sequence',
  templateVersion: 'template_version',
  payloadCiphertext: 'payload_ciphertext',
  payloadIv: 'payload_iv',
  payloadTag: 'payload_tag',
  payloadKeyId: 'payload_key_id',
  status: 'status',
  createdAt: 'created_at',
  expiresAt: 'expires_at',
  nextAttemptAt: 'next_attempt_at',
  enqueuedAt: 'enqueued_at',
  submittedAt: 'submitted_at',
  terminalAt: 'terminal_at',
  leaseUntil: 'lease_until',
  leaseToken: 'lease_token',
  dispatchAttempts: 'dispatch_attempts',
  sendAttempts: 'send_attempts',
  lastErrorCode: 'last_error_code',
  providerMessageId: 'provider_message_id',
} satisfies Record<keyof NotificationRow, string>
const selection = sql.join(
  Object.entries(columns).map(
    ([key, col]) => sql`${sql.identifier(col)} AS ${sql.identifier(key)}`,
  ),
  sql`, `,
)
const timestamps = [
  'createdAt',
  'expiresAt',
  'nextAttemptAt',
  'enqueuedAt',
  'submittedAt',
  'terminalAt',
  'leaseUntil',
] as const
const terminal = sql`('SUBMITTED','EXPIRED','SKIPPED','FAILED','UNCERTAIN')`
type Runner = (query: SQL) => Promise<Record<string, unknown>[]>

// Shared SQL uses only bound values and application-owned column identifiers.
// Atomic conditional UPDATE claims work across processes on both engines.
export function createEmailQueries(run: Runner, postgres = false) {
  async function rows(query: SQL): Promise<NotificationRow[]> {
    return (await run(query)).map((raw) => {
      for (const key of timestamps) if (raw[key] != null) raw[key] = Number(raw[key])
      return raw as NotificationRow
    })
  }
  return {
    async insertEmailNotification(values) {
      const entries = Object.entries(values).filter(([, v]) => v !== undefined) as [
        keyof NotificationRow,
        unknown,
      ][]
      await run(
        sql`INSERT INTO email_notifications (${sql.join(
          entries.map(([k]) => sql.identifier(columns[k])),
          sql`, `,
        )}) VALUES (${sql.join(
          entries.map(([, v]) => sql`${v}`),
          sql`, `,
        )}) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
      )
    },
    async emailNotification(id) {
      return (await rows(sql`SELECT ${selection} FROM email_notifications WHERE id=${id}`))[0]
    },
    async emailByDedupe(key) {
      return (
        await rows(sql`SELECT ${selection} FROM email_notifications WHERE dedupe_key=${key}`)
      )[0]
    },
    async emailOrderSequence(orderId) {
      const result = await run(
        sql`SELECT COALESCE(MAX(sequence),0)+1 AS value FROM email_notifications WHERE order_id=${orderId}`,
      )
      return Number(result[0].value)
    },
    async dueEmailNotifications(now, limit, queue) {
      return rows(
        sql`SELECT ${selection} FROM email_notifications WHERE (status='PENDING' OR (status='ENQUEUED' AND (enqueued_at IS NULL OR enqueued_at<=${now - 30000}))) AND next_attempt_at<=${now} AND (lease_until IS NULL OR lease_until<=${now}) ${queue ? sql`AND queue=${queue}` : sql``} ORDER BY created_at,id LIMIT ${limit}`,
      )
    },
    async claimEmailDispatch(id, now, token) {
      return (
        await rows(
          sql`UPDATE email_notifications SET lease_token=${token},lease_until=${now + 30000},dispatch_attempts=dispatch_attempts+1 WHERE id=${id} AND status IN ('PENDING','ENQUEUED') AND next_attempt_at<=${now} AND (lease_until IS NULL OR lease_until<=${now}) RETURNING ${selection}`,
        )
      )[0]
    },
    async claimEmailSend(id, now, token) {
      return (
        await rows(
          sql`UPDATE email_notifications SET status='SENDING',lease_token=${token},lease_until=${now + 60000},send_attempts=send_attempts+1 WHERE id=${id} AND status IN ('PENDING','ENQUEUED') AND next_attempt_at<=${now} AND (expires_at IS NULL OR expires_at>${now + 120000}) AND send_attempts < CASE WHEN queue='AUTH' THEN 4 ELSE 8 END AND NOT EXISTS (SELECT 1 FROM email_notifications AS prior WHERE prior.order_id=email_notifications.order_id AND prior.sequence<email_notifications.sequence AND prior.status NOT IN ${terminal}) RETURNING ${selection}`,
        )
      )[0]
    },
    async updateEmailNotification(id, values, token) {
      const entries = Object.entries(values).filter(([k]) => !['id', 'dedupeKey'].includes(k)) as [
        keyof NotificationRow,
        unknown,
      ][]
      if (!entries.length) return false
      return (
        (
          await run(
            sql`UPDATE email_notifications SET ${sql.join(
              entries.map(([k, v]) => sql`${sql.identifier(columns[k])}=${v}`),
              sql`, `,
            )} WHERE id=${id} AND lease_token=${token} RETURNING id`,
          )
        ).length > 0
      )
    },
    async recoverEmailNotifications(now) {
      const uncertain = await rows(
        sql`UPDATE email_notifications SET status='UNCERTAIN',terminal_at=${now},last_error_code='SEND_LEASE_EXPIRED',lease_token=NULL,lease_until=NULL WHERE status='SENDING' AND lease_until<=${now} RETURNING ${selection}`,
      )
      const expired = await rows(
        sql`UPDATE email_notifications SET status='EXPIRED',terminal_at=${now},last_error_code='LINK_EXPIRED',lease_token=NULL,lease_until=NULL WHERE status IN ('PENDING','ENQUEUED') AND expires_at<=${now + 120000} RETURNING ${selection}`,
      )
      return [...uncertain, ...expired]
    },
    async cleanupEmailNotifications(now) {
      await run(
        sql`UPDATE email_notifications SET payload_ciphertext=NULL,payload_iv=NULL,payload_tag=NULL,payload_key_id=NULL WHERE id IN (SELECT id FROM email_notifications WHERE payload_ciphertext IS NOT NULL AND ((queue='AUTH' AND (status IN ${terminal} OR expires_at<=${now})) OR (queue='ORDER' AND terminal_at<=${now - 7 * 86400000})) LIMIT 100) RETURNING id`,
      )
      await run(
        sql`DELETE FROM email_notifications WHERE id IN (SELECT id FROM email_notifications WHERE terminal_at<=${now - 90 * 86400000} LIMIT 100) RETURNING id`,
      )
    },
    async emailResetValid(token, userId, now) {
      const cutoff = postgres ? sql`${new Date(now)}` : sql`${now}`
      return (
        (
          await run(
            sql`SELECT id FROM verification WHERE identifier=${`reset-password:${token}`} AND value=${userId} AND expires_at>${cutoff} LIMIT 1`,
          )
        ).length > 0
      )
    },
    async emailResetExpiry(token) {
      const row = (
        await run(
          sql`SELECT expires_at AS expiry FROM verification WHERE identifier=${`reset-password:${token}`} LIMIT 1`,
        )
      )[0]
      return row ? Number(postgres ? new Date(String(row.expiry)) : row.expiry) : undefined
    },
    async emailPayloadKeyIds() {
      return (
        await run(
          sql`SELECT DISTINCT payload_key_id AS key FROM email_notifications WHERE status IN ('PENDING','ENQUEUED','SENDING') AND payload_key_id IS NOT NULL`,
        )
      ).map((row) => String(row.key))
    },
  } satisfies Pick<
    DomainStore,
    | 'insertEmailNotification'
    | 'emailNotification'
    | 'emailByDedupe'
    | 'emailOrderSequence'
    | 'dueEmailNotifications'
    | 'claimEmailDispatch'
    | 'claimEmailSend'
    | 'updateEmailNotification'
    | 'recoverEmailNotifications'
    | 'cleanupEmailNotifications'
    | 'emailResetValid'
    | 'emailResetExpiry'
    | 'emailPayloadKeyIds'
  >
}
