import { randomUUID } from 'node:crypto'
import type { Queue } from 'bullmq'
import type { EmailNotificationRepository } from './email-notification.repository.js'
import type { EmailQueue } from './email-notification.types.js'
import type { EmailJobData } from './email-queue.js'
import { log } from '../../shared/logger.js'

export function createEmailDispatcher(
  repo: EmailNotificationRepository,
  queues: Record<EmailQueue, Queue<EmailJobData>>,
  clock = Date.now,
  availableKeys?: string[],
) {
  let running = false
  let lastReconcile = 0
  return async () => {
    if (running) return
    running = true
    try {
      const now = clock()
      await repo.recover(now)
      if (availableKeys) await repo.assertKeysAvailable(availableKeys)
      const reconcile = now - lastReconcile >= 30000
      if (reconcile) lastReconcile = now
      // A separate batch for each queue prevents an order backlog starving authentication.
      for (const queueKind of ['AUTH', 'ORDER'] as const) {
        for (const candidate of await repo.due(now, 50, queueKind)) {
          if (reconcile && now - candidate.createdAt > (queueKind === 'AUTH' ? 60000 : 300000))
            log('warn', 'email.backlog_overdue', {
              component: 'email',
              notificationId: candidate.id,
              emailQueue: queueKind,
              emailStatus: candidate.status,
              pendingAgeMs: now - candidate.createdAt,
            })
          if (candidate.status === 'ENQUEUED' && !reconcile) continue
          const token = randomUUID()
          const row = await repo.claimDispatch(candidate.id, now, token)
          if (!row) continue
          try {
            const queue = queues[row.queue]
            const existing = await queue.getJob(row.id)
            if (existing) {
              const state = await existing.getState()
              if (state === 'completed' || state === 'failed') await existing.remove()
              else {
                await repo.markEnqueued(row.id, token, clock())
                continue
              }
            }
            await queue.add('send-email', { notificationId: row.id }, { jobId: row.id })
            await repo.markEnqueued(row.id, token, clock())
          } catch {
            await repo.releaseDispatch(row.id, token, clock(), 'REDIS_PUBLISH_FAILED')
            log('error', 'email.dispatch_failed', {
              component: 'email',
              errorCode: 'REDIS_PUBLISH_FAILED',
            })
          }
        }
      }
    } finally {
      running = false
    }
  }
}
