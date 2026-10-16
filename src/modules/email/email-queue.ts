import { Queue } from 'bullmq'
import { Redis } from 'ioredis'
import type { EmailConfig } from './email-config.js'
import type { EmailQueue } from './email-notification.types.js'
import { log } from '../../shared/logger.js'

export const emailQueueName = (queue: EmailQueue) =>
  queue === 'AUTH' ? 'auth-emails' : 'order-emails'
export type EmailJobData = { notificationId: string }
export function emailRedis(config: EmailConfig, consumer = false) {
  if (!config.redisUrl) throw new Error('EMAIL_REDIS_REQUIRED')
  const redis = new Redis(config.redisUrl, {
    maxRetriesPerRequest: consumer ? null : 1,
    enableOfflineQueue: consumer,
    connectTimeout: 5000,
    retryStrategy: (times) => Math.min(times * 250, 5000),
  })
  redis.on('error', () =>
    log('error', 'email.redis_error', { component: 'email', errorCode: 'REDIS_UNAVAILABLE' }),
  )
  return redis
}
export function createEmailQueues(config: EmailConfig) {
  const connection = emailRedis(config)
  const options = {
    connection,
    prefix: config.prefix,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { age: 86400, count: 10000 },
      removeOnFail: { age: 7 * 86400, count: 10000 },
    },
  }
  const queues = {
    AUTH: new Queue<EmailJobData>(emailQueueName('AUTH'), options),
    ORDER: new Queue<EmailJobData>(emailQueueName('ORDER'), options),
  }
  for (const queue of Object.values(queues))
    queue.on('error', () =>
      log('error', 'email.queue_error', { component: 'email', errorCode: 'QUEUE_UNAVAILABLE' }),
    )
  return {
    queues,
    connection,
    async close() {
      await Promise.all(Object.values(queues).map((queue) => queue.close()))
      connection.disconnect()
    },
  }
}
