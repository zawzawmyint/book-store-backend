import { randomUUID } from 'node:crypto'
import { log } from '../../shared/logger.js'
import { normalizeStore, type DatabaseInput } from '../../database/persistence.js'
import type { NotificationRow } from '../../database/store.types.js'
import type { EmailCrypto } from './email-payload.crypto.js'
import type { EmailPayload } from './email-notification.types.js'

export function createEmailNotificationRepository(
  input: DatabaseInput,
  crypto: EmailCrypto,
  clock = Date.now,
) {
  const store = normalizeStore(input)
  const purgeAuth = (row: NotificationRow) =>
    row.queue === 'AUTH'
      ? {
          payloadCiphertext: null,
          payloadIv: null,
          payloadTag: null,
          payloadKeyId: null,
        }
      : {}
  async function finish(
    id: string,
    token: string,
    status: 'SUBMITTED' | 'EXPIRED' | 'SKIPPED' | 'FAILED' | 'UNCERTAIN',
    now: number,
    errorCode?: string,
  ) {
    const row = await store.emailNotification(id)
    if (
      !row ||
      row.status !== 'SENDING' ||
      row.leaseToken !== token ||
      !row.leaseUntil ||
      row.leaseUntil <= now
    )
      return false
    return store.updateEmailNotification(
      id,
      {
        status,
        terminalAt: now,
        submittedAt: status === 'SUBMITTED' ? now : null,
        lastErrorCode: errorCode ?? null,
        leaseToken: null,
        leaseUntil: null,
        ...purgeAuth(row),
      },
      token,
    )
  }
  return {
    async assertKeysAvailable(available: string[]) {
      const configured = new Set(available)
      if ((await store.emailPayloadKeyIds()).some((key) => !configured.has(key))) {
        log('error', 'email.payload_key_unavailable', {
          component: 'email',
          errorCode: 'EMAIL_PAYLOAD_KEY_UNAVAILABLE',
        })
        throw new Error('EMAIL_PAYLOAD_KEY_UNAVAILABLE')
      }
    },
    async deferForMissingKey(id: string, token: string, now: number) {
      const row = await store.emailNotification(id)
      if (
        !row ||
        row.status !== 'SENDING' ||
        row.leaseToken !== token ||
        !row.leaseUntil ||
        row.leaseUntil <= now
      )
        return false
      return store.updateEmailNotification(
        id,
        {
          status: 'PENDING',
          leaseToken: null,
          leaseUntil: null,
          nextAttemptAt: now + 60000,
          sendAttempts: Math.max(0, row.sendAttempts - 1),
          lastErrorCode: 'EMAIL_PAYLOAD_KEY_UNAVAILABLE',
        },
        token,
      )
    },
    get: store.emailNotification,
    due: (now: number, limit = 50, queue?: 'AUTH' | 'ORDER') =>
      store.dueEmailNotifications(now, limit, queue),
    claimDispatch: store.claimEmailDispatch,
    async markEnqueued(id: string, token: string, now: number) {
      return store.updateEmailNotification(
        id,
        { status: 'ENQUEUED', enqueuedAt: now, leaseUntil: null, leaseToken: null },
        token,
      )
    },
    async releaseDispatch(id: string, token: string, now: number, code: string) {
      const row = await store.emailNotification(id)
      if (!row) return false
      return store.updateEmailNotification(
        id,
        {
          leaseUntil: null,
          leaseToken: null,
          nextAttemptAt: now + Math.min(60000, 1000 * 2 ** Math.min(row.dispatchAttempts - 1, 6)),
          lastErrorCode: code,
        },
        token,
      )
    },
    claimSend: store.claimEmailSend,
    finish,
    async retry(id: string, token: string, now: number, errorCode: string) {
      const row = await store.emailNotification(id)
      if (
        !row ||
        row.status !== 'SENDING' ||
        row.leaseToken !== token ||
        !row.leaseUntil ||
        row.leaseUntil <= now
      )
        return false
      if (row.sendAttempts >= (row.queue === 'AUTH' ? 4 : 8))
        return finish(id, token, 'FAILED', now, errorCode)
      return store.updateEmailNotification(
        id,
        {
          status: 'PENDING',
          leaseToken: null,
          leaseUntil: null,
          nextAttemptAt: now + 5000 * 2 ** (row.sendAttempts - 1),
          lastErrorCode: errorCode,
        },
        token,
      )
    },
    async authEligible(row: NotificationRow, payload: EmailPayload) {
      if (row.queue !== 'AUTH') return true
      if (!row.userId) return false
      const user = await store.user(row.userId)
      if (!user || user.email !== payload.to) return false
      if (row.kind === 'VERIFY_EMAIL') return !user.emailVerified
      return !!payload.resetToken && store.emailResetValid(payload.resetToken, row.userId, clock())
    },
    async recover(now: number) {
      for (const row of await store.recoverEmailNotifications(now)) {
        log(
          row.status === 'UNCERTAIN' ? 'error' : 'info',
          row.status === 'UNCERTAIN' ? 'email.uncertain' : 'email.expired',
          {
            component: 'email',
            notificationId: row.id,
            emailQueue: row.queue,
            emailStatus: row.status,
            errorCode: row.status === 'UNCERTAIN' ? 'SEND_LEASE_EXPIRED' : 'LINK_EXPIRED',
          },
        )
      }
      await store.cleanupEmailNotifications(now)
    },
    cleanup: store.cleanupEmailNotifications,
    async inspect(id: string) {
      const row = await store.emailNotification(id)
      if (!row) return null
      return {
        id: row.id,
        kind: row.kind,
        queue: row.queue,
        status: row.status,
        createdAt: row.createdAt,
        sendAttempts: row.sendAttempts,
        dispatchAttempts: row.dispatchAttempts,
        lastErrorCode: row.lastErrorCode,
        terminalAt: row.terminalAt,
        replayOfId: row.replayOfId,
      }
    },
    async replay(id: string, acknowledgeDuplicateRisk = false, apply = false) {
      return store.transaction(async (tx) => {
        const original = await tx.emailNotification(id)
        if (
          !original ||
          !['FAILED', 'UNCERTAIN'].includes(original.status) ||
          !original.payloadCiphertext ||
          (original.expiresAt !== null && original.expiresAt <= clock() + 120000)
        )
          throw new Error('EMAIL_REPLAY_UNAVAILABLE')
        if (original.status === 'UNCERTAIN' && !acknowledgeDuplicateRisk)
          throw new Error('EMAIL_REPLAY_ACK_REQUIRED')
        if (!apply) return { originalId: id, status: original.status, applied: false }
        if (original.orderId) await tx.order(original.orderId)
        const payload = crypto.open(original)
        const replayId = randomUUID()
        await tx.insertEmailNotification({
          id: replayId,
          dedupeKey: crypto.digest(`replay:${replayId}`),
          kind: original.kind,
          queue: original.queue,
          userId: original.userId,
          orderId: original.orderId,
          replayOfId: id,
          sequence: original.orderId ? await tx.emailOrderSequence(original.orderId) : null,
          templateVersion: original.templateVersion,
          createdAt: clock(),
          nextAttemptAt: clock(),
          expiresAt: original.expiresAt,
          ...crypto.seal(replayId, original.kind, payload, original.templateVersion),
        })
        return { originalId: id, notificationId: replayId, applied: true }
      })
    },
  }
}
export type EmailNotificationRepository = ReturnType<typeof createEmailNotificationRepository>
