import { randomUUID } from 'node:crypto'
import type { EmailNotificationRepository } from './email-notification.repository.js'
import type { EmailCrypto } from './email-payload.crypto.js'
import type { EmailSender } from './email.service.js'
import { renderNotification } from './email.templates.js'
import { log } from '../../shared/logger.js'

export function classifySmtpFailure(error: unknown): 'RETRY' | 'FAILED' | 'UNCERTAIN' {
  const e = error as { code?: string; responseCode?: number; command?: string } | null
  if (!e || typeof e !== 'object') return 'UNCERTAIN'
  // An explicit negative SMTP reply rejects responsibility, including DATA rejection.
  if (e.responseCode && e.responseCode >= 400 && e.responseCode < 500) return 'RETRY'
  if (e.code === 'EAUTH' || e.code === 'EENVELOPE' || (e.responseCode && e.responseCode >= 500))
    return 'FAILED'
  // Only connection establishment and rejected pre-DATA commands prove no body was accepted.
  const preData = ['CONN', 'EHLO', 'HELO', 'STARTTLS', 'AUTH', 'MAIL FROM', 'RCPT TO'].includes(
    e.command ?? '',
  )
  if (
    preData &&
    (['ECONNECTION', 'ECONNREFUSED', 'ETIMEDOUT', 'EDNS', 'ESOCKET'].includes(e.code ?? '') ||
      (e.responseCode && e.responseCode >= 400 && e.responseCode < 500))
  )
    return 'RETRY'
  return 'UNCERTAIN'
}

export function createEmailConsumer(input: {
  repository: EmailNotificationRepository
  crypto: EmailCrypto
  sender: EmailSender
  frontendOrigin: string
  clock?: () => number
}) {
  const { repository: repo, crypto, sender } = input
  const clock = input.clock ?? Date.now
  return async (notificationId: string) => {
    if (!/^[a-f0-9-]{36}$/i.test(notificationId)) return
    const token = randomUUID()
    const row = await repo.claimSend(notificationId, clock(), token)
    if (!row) return
    let payload
    let message
    try {
      payload = crypto.open(row)
      message = renderNotification(row.kind, payload, input.frontendOrigin)
    } catch (error) {
      if (error instanceof Error && error.message === 'EMAIL_PAYLOAD_KEY_UNAVAILABLE') {
        await repo.deferForMissingKey(row.id, token, clock())
        log('error', 'email.payload_key_unavailable', {
          component: 'email',
          notificationId: row.id,
          emailQueue: row.queue,
          errorCode: 'EMAIL_PAYLOAD_KEY_UNAVAILABLE',
        })
        return
      }
      await repo.finish(row.id, token, 'FAILED', clock(), 'EMAIL_PAYLOAD_INVALID')
      log('error', 'email.payload_invalid', {
        component: 'email',
        notificationId: row.id,
        emailQueue: row.queue,
        errorCode: 'EMAIL_PAYLOAD_INVALID',
      })
      return
    }
    let eligible: boolean
    try {
      eligible = await repo.authEligible(row, payload)
    } catch {
      await repo.retry(row.id, token, clock(), 'EMAIL_ELIGIBILITY_UNAVAILABLE')
      return
    }
    if (!eligible) {
      await repo.finish(row.id, token, 'SKIPPED', clock(), 'RECIPIENT_INELIGIBLE')
      return
    }
    const current = await repo.get(row.id)
    if (
      !current ||
      current.status !== 'SENDING' ||
      current.leaseToken !== token ||
      !current.leaseUntil ||
      current.leaseUntil <= clock()
    )
      return
    if (row.expiresAt !== null && row.expiresAt <= clock() + 120000) {
      await repo.finish(row.id, token, 'EXPIRED', clock(), 'LINK_EXPIRED')
      return
    }
    try {
      await sender.send(message)
      const finished = await repo.finish(row.id, token, 'SUBMITTED', clock())
      if (finished)
        log('info', 'email.submitted', {
          component: 'email',
          notificationId: row.id,
          emailQueue: row.queue,
          emailStatus: 'SUBMITTED',
        })
    } catch (error) {
      const outcome = classifySmtpFailure(error)
      if (outcome === 'RETRY') await repo.retry(row.id, token, clock(), 'SMTP_TRANSIENT')
      else
        await repo.finish(
          row.id,
          token,
          outcome,
          clock(),
          outcome === 'FAILED' ? 'SMTP_PERMANENT' : 'SMTP_UNCERTAIN',
        )
      log('error', outcome === 'UNCERTAIN' ? 'email.uncertain' : 'email.send_failed', {
        component: 'email',
        notificationId: row.id,
        emailQueue: row.queue,
        emailStatus: outcome === 'RETRY' ? 'PENDING' : outcome,
        errorCode: outcome === 'UNCERTAIN' ? 'SMTP_UNCERTAIN' : 'SMTP_SEND_FAILED',
      })
    }
  }
}
