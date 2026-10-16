import 'dotenv/config'
import Database from 'better-sqlite3'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { DelayedError, Worker } from 'bullmq'
import { loadConfig } from '../../config/env.js'
import { openDatabase, sqliteHandle } from '../../database/runtime.js'
import { loadEmailConfig, type EmailConfig } from './email-config.js'
import { createEmailCrypto } from './email-payload.crypto.js'
import {
  createEmailNotificationRepository,
  type EmailNotificationRepository,
} from './email-notification.repository.js'
import { createEmailSender, type EmailSender } from './email.service.js'
import { createEmailQueues, emailQueueName, emailRedis, type EmailJobData } from './email-queue.js'
import { createEmailConsumer } from './email-consumer.js'
import { createEmailDispatcher } from './email-dispatcher.js'
import type { EmailCrypto } from './email-payload.crypto.js'
import { log } from '../../shared/logger.js'

export function emailWorkerReady(
  lastProgress: number,
  now: number,
  redisReady: boolean,
  stopped: boolean,
  consumersReady = true,
) {
  return !stopped && redisReady && consumersReady && now - lastProgress < 30000
}
export async function drainEmailWork(work: Promise<unknown>[], timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.allSettled(work).then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function startEmailRuntime(input: {
  config: EmailConfig
  repository: EmailNotificationRepository
  crypto: EmailCrypto
  sender: EmailSender
  frontendOrigin: string
}) {
  const { config, repository } = input
  await repository.recover(Date.now())
  await repository.assertKeysAvailable(Object.keys(config.keys))
  const queueSet = createEmailQueues(config)
  const consumerConnection = emailRedis(config, true)
  const consumer = createEmailConsumer(input)
  const dispatch = createEmailDispatcher(repository, queueSet.queues)
  let lastProgress = 0
  let stopped = false
  let ticking = false
  let activeTick: Promise<void> | undefined
  const activeSends = new Set<Promise<void>>()
  const workers = (['AUTH', 'ORDER'] as const).map((kind) => {
    const worker = new Worker<EmailJobData>(
      emailQueueName(kind),
      (job, token) => {
        if (stopped) return Promise.resolve()
        const work = (async () => {
          await consumer(job.data.notificationId)
          if (stopped) return
          const row = await repository.get(job.data.notificationId)
          if (row && ['PENDING', 'ENQUEUED'].includes(row.status)) {
            // Keep ordered successors and ledger retries scheduled without
            // completing them and waiting for the Redis-loss reconciliation sweep.
            await job.moveToDelayed(Math.max(row.nextAttemptAt, Date.now() + 1000), token)
            throw new DelayedError()
          }
        })()
        activeSends.add(work)
        void work.finally(() => activeSends.delete(work)).catch(() => {})
        return work
      },
      {
        connection: consumerConnection,
        prefix: config.prefix,
        concurrency: kind === 'AUTH' ? config.authConcurrency : config.orderConcurrency,
      },
    )
    worker.on('error', () =>
      log('error', 'email.worker_error', { component: 'email', errorCode: 'QUEUE_WORKER_FAILED' }),
    )
    worker.on('failed', () =>
      log('error', 'email.job_failed', { component: 'email', errorCode: 'QUEUE_JOB_FAILED' }),
    )
    return worker
  })
  const health = createServer((request, response) => {
    const live = !stopped
    const ready = emailWorkerReady(
      lastProgress,
      Date.now(),
      queueSet.connection.status === 'ready' && consumerConnection.status === 'ready',
      stopped,
      workers.every((worker) => worker.isRunning() && !worker.isPaused()),
    )
    const known = request.url === '/health' || request.url === '/ready'
    const ok = request.url === '/health' ? live : ready
    response.writeHead(!known ? 404 : ok ? 200 : 503, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ status: !known ? 'unknown' : ok ? 'ok' : 'unavailable' }))
  })
  const tick = async () => {
    if (stopped || ticking) return
    ticking = true
    try {
      await repository.assertKeysAvailable(Object.keys(config.keys))
      await dispatch()
      lastProgress = Date.now()
    } catch {
      log('error', 'email.dispatch_loop_failed', {
        component: 'email',
        errorCode: 'DISPATCH_LOOP_FAILED',
      })
    } finally {
      ticking = false
    }
  }
  try {
    const ready = Promise.all(workers.map((worker) => worker.waitUntilReady()))
    if (!(await drainEmailWork([ready], 10000))) throw new Error('EMAIL_REDIS_START_TIMEOUT')
    await ready
    await repository.due(Date.now(), 1)
    await new Promise<void>((resolve, reject) => {
      health.once('error', reject)
      health.listen(config.healthPort, '127.0.0.1', resolve)
    })
    await tick()
  } catch (error) {
    await Promise.allSettled(workers.map((worker) => worker.close(true)))
    await queueSet.close()
    consumerConnection.disconnect()
    health.close()
    throw error
  }
  const timer = setInterval(() => {
    if (!stopped && !ticking) activeTick = tick()
  }, 1000)
  const heartbeat = setInterval(() => {
    log('info', 'email.worker_heartbeat', {
      component: 'email',
      heartbeatAgeMs: Date.now() - lastProgress,
    })
  }, 10000)
  return async () => {
    stopped = true
    clearInterval(timer)
    clearInterval(heartbeat)
    health.close()
    // Pause intake first, drain our tracked work, then invoke close(force) ONCE.
    // BullMQ caches its first close promise; escalating an existing close cannot force it.
    await Promise.allSettled(workers.map((worker) => worker.pause(true)))
    const drained = await drainEmailWork(
      [...activeSends, ...(activeTick ? [activeTick] : [])],
      29000,
    )
    if (!drained) input.sender.close?.()
    await drainEmailWork(
      workers.map((worker) => worker.close(true)),
      1000,
    )
    await queueSet.close()
    consumerConnection.disconnect()
    input.sender.close?.()
  }
}

export async function openEmailWorkerDatabase(config: ReturnType<typeof loadConfig>) {
  if (config.databaseProvider !== 'sqlite') return openDatabase(config)
  // Worker never creates files, seeds, or migrates schema. API/migration command owns that.
  const raw = new Database(config.databasePath, { fileMustExist: true })
  raw.pragma('foreign_keys = ON')
  return {
    handle: sqliteHandle(raw),
    async close() {
      raw.close()
    },
  }
}
async function main() {
  const config = loadConfig(process.env, 'worker')
  const emailConfig = loadEmailConfig(process.env, 'worker')
  if (!config.smtp) throw new Error('EMAIL_SMTP_REQUIRED')
  const database = await openEmailWorkerDatabase(config)
  try {
    const crypto = createEmailCrypto(emailConfig)
    const stop = await startEmailRuntime({
      config: emailConfig,
      crypto,
      repository: createEmailNotificationRepository(database.handle, crypto),
      sender: createEmailSender(config.smtp),
      frontendOrigin: config.frontendOrigin,
    })
    let stopping = false
    const shutdown = () => {
      if (stopping) return
      stopping = true
      void stop()
        .finally(() => database.close())
        .catch(() => {
          process.exitCode = 1
        })
    }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
    log('info', 'email.worker_started', { component: 'email' })
  } catch (error) {
    await database.close()
    throw error
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch(() => {
    log('error', 'email.worker_start_failed', {
      component: 'email',
      errorCode: 'EMAIL_WORKER_START_FAILED',
    })
    process.exitCode = 1
  })
}
