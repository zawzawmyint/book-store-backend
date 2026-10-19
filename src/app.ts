import { createLocalCoverStorage } from './modules/covers/local-cover.storage.js'
import { mountCoverRoutes } from './modules/covers/cover.routes.js'
import type { CoverStorage } from './modules/covers/cover.storage.js'
import express from 'express'
import type { EmailConfig } from './modules/email/email-config.js'
import { createEmailCrypto } from './modules/email/email-payload.crypto.js'
import { createEmailOutboxWriter } from './modules/email/email-outbox.writer.js'
import { normalizeStore } from './database/persistence.js'
import { isIP } from 'node:net'
import { randomUUID } from 'node:crypto'
import { log, withRequestContext } from './shared/logger.js'
import { createReadinessProbe } from './database/readiness.js'
import { operationalLoggingPlugin } from './graphql/logging.js'
import cors from 'cors'
import { ApolloServer } from '@apollo/server'
import { expressMiddleware } from '@as-integrations/express5'
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node'
import type { DatabaseHandle } from './database/runtime.js'
import type Database from 'better-sqlite3'
import { createPaymentRepository } from './modules/payments/payment.repository.js'
import { createAuth, type AuthOptions } from './auth.js'
import type { GraphQLContext } from './graphql/context.js'
import { createResolvers } from './graphql/resolvers.js'
import { typeDefs } from './graphql/schema.js'
import { publicGraphQLError } from './graphql/errors.js'
import { createPaymentService, type PaymentOptions } from './modules/payments/payment.service.js'

const authBodyLimit = 64 * 1024

function clientIp(req: express.Request, trustedProxyIp?: string) {
  const peer = req.socket.remoteAddress ?? 'unknown'
  const normalizedPeer = peer.replace(/^::ffff:/, '')
  if (trustedProxyIp && normalizedPeer === trustedProxyIp.replace(/^::ffff:/, '')) {
    const realIp = req.get('x-real-ip')
    if (realIp && isIP(realIp)) return realIp
  }
  return peer
}

export async function createApp(
  db: DatabaseHandle | Database.Database,
  options: AuthOptions & {
    emailConfig?: EmailConfig
    covers?: { directory: string; publicBaseUrl: string; storage?: CoverStorage }
  },
  paymentOptions: Omit<PaymentOptions, 'frontendOrigin'> = {},
) {
  const coverStorage =
    options.covers?.storage ??
    (options.covers
      ? await createLocalCoverStorage(options.covers.directory, options.covers.publicBaseUrl)
      : undefined)
  const queuedEmail =
    options.emailConfig?.mode === 'queued'
      ? createEmailOutboxWriter(
          db,
          createEmailCrypto(options.emailConfig),
          paymentOptions.now ?? Date.now,
        )
      : undefined
  if (queuedEmail) await normalizeStore(db).dueEmailNotifications(Date.now(), 1)
  const paymentRepository = createPaymentRepository(
    db,
    paymentOptions.now ?? Date.now,
    options.emailConfig?.orderNotificationsEnabled ? queuedEmail?.writeOrderEmail : undefined,
  )
  const paymentService = createPaymentService(paymentRepository, {
    ...paymentOptions,
    frontendOrigin: options.frontendOrigin,
  })
  const auth = createAuth(
    db,
    queuedEmail
      ? { ...options, emailSender: undefined, enqueueAuthEmail: queuedEmail.enqueueAuthEmail }
      : options,
  )
  const server = new ApolloServer<GraphQLContext>({
    typeDefs,
    resolvers: createResolvers(db, paymentService, coverStorage),
    formatError: publicGraphQLError,
    plugins: [operationalLoggingPlugin],
  })
  try {
    await server.start()
  } catch (error) {
    await server.stop().catch(() => undefined)
    throw error
  }
  try {
    const app = express()
    app.disable('x-powered-by')
    app.use((req, res, next) => {
      const requestId = randomUUID()
      const started = performance.now()
      const route =
        req.path === '/health' ||
        req.path === '/ready' ||
        req.path === '/graphql' ||
        req.path === '/api/payments/stripe/webhook'
          ? req.path
          : req.path.startsWith('/api/auth/')
            ? '/api/auth/*'
            : 'unmatched'
      res.setHeader('X-Request-ID', requestId)
      let completed = false
      const complete = () => {
        if (completed) return
        completed = true
        if (route === '/health' || route === '/ready') return
        withRequestContext(requestId, () =>
          log(
            !res.writableFinished
              ? 'warn'
              : res.statusCode >= 500
                ? 'error'
                : res.statusCode >= 400
                  ? 'warn'
                  : 'info',
            res.writableFinished ? 'http.completed' : 'http.aborted',
            {
              component: 'http',
              route,
              method: req.method,
              statusCode: res.statusCode,
              durationMs: Math.round(performance.now() - started),
            },
          ),
        )
      }
      res.once('finish', complete)
      res.once('close', complete)
      withRequestContext(requestId, next)
    })
    app.get('/health', (_req, res) => res.json({ status: 'ok' }))
    const readiness = createReadinessProbe(
      db,
      queuedEmail
        ? async () => {
            await normalizeStore(db).emailNotification('00000000-0000-0000-0000-000000000000')
          }
        : undefined,
    )
    app.get('/ready', async (_req, res) => {
      res.setHeader('Cache-Control', 'no-store')
      const ready = await readiness()
      res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable' })
    })
    app.locals.payments = paymentService
    app.locals.close = async () => {
      await auth.closeMail()
      await server.stop()
    }
    app.post(
      '/api/payments/stripe/webhook',
      express.raw({ type: 'application/json', limit: '100kb' }),
      async (req, res) => {
        if (!paymentOptions.provider) {
          res.sendStatus(503)
          return
        }
        let event
        try {
          event = paymentOptions.provider.verifyWebhook(req.body, req.get('stripe-signature') ?? '')
          if (
            !event ||
            typeof event.id !== 'string' ||
            !event.id ||
            typeof event.type !== 'string' ||
            !event.type ||
            typeof event.resourceId !== 'string'
          )
            throw new Error('Invalid event envelope')
        } catch {
          log('warn', 'payment.webhook_invalid', {
            component: 'payments',
            errorCode: 'INVALID_WEBHOOK',
          })
          res.sendStatus(400)
          return
        }
        try {
          await paymentService.handleEvent(event)
          res.sendStatus(200)
        } catch {
          log('error', 'payment.webhook_failed', {
            component: 'payments',
            errorCode: 'PAYMENT_UNAVAILABLE',
          })
          res.sendStatus(503)
        }
      },
    )
    app.all(
      '/api/auth/*splat',
      cors({ origin: options.frontendOrigin, credentials: true }),
      (req, res, next) => {
        // Better Auth must never use a caller-supplied forwarded IP for rate limiting.
        req.headers['x-bookstore-client-ip'] = clientIp(req, options.trustedProxyIp)
        if (req.method === 'GET' || req.method === 'HEAD') return next()
        let size = 0
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size <= authBodyLimit) chunks.push(chunk)
          else chunks.length = 0
        })
        req.on('end', () => {
          if (size > authBodyLimit) {
            res.status(413).json({ error: 'Auth request body is too large' })
            return
          }
          req.body = Buffer.concat(chunks).toString('utf8')
          next()
        })
        req.on('error', next)
      },
      toNodeHandler(auth),
    )
    if (coverStorage)
      mountCoverRoutes(
        app,
        db,
        auth,
        options.frontendOrigin,
        coverStorage,
        'mediaDirectory' in coverStorage ? String(coverStorage.mediaDirectory) : undefined,
      )
    app.use(
      '/graphql',
      cors({ origin: options.frontendOrigin, credentials: true }),
      express.json({ limit: '100kb' }),
      (req, res, next) => {
        if (req.method === 'POST' && req.headers.cookie) {
          if (req.get('origin') !== options.frontendOrigin || !req.is('application/json')) {
            res.status(403).json({ error: 'Forbidden origin or content type' })
            return
          }
        }
        next()
      },
      expressMiddleware(server, {
        context: async ({ req }) => {
          const session = await auth.api.getSession({
            headers: fromNodeHeaders(req.headers),
            query: { disableCookieCache: true },
          })
          return {
            user: session?.user.emailVerified ? session.user : null,
            expectedCartAccount: req.get('x-cart-account'),
          }
        },
      }),
    )
    app.use(
      (
        error: unknown,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        // Body-parser categories are safe; never serialize the error/body itself.
        const type = error && typeof error === 'object' && 'type' in error ? error.type : undefined
        const status =
          type === 'entity.too.large'
            ? 413
            : type === 'charset.unsupported' || type === 'encoding.unsupported'
              ? 415
              : type === 'entity.parse.failed' ||
                  type === 'request.aborted' ||
                  type === 'request.size.invalid'
                ? 400
                : 500
        log(status === 500 ? 'error' : 'warn', 'http.failed', {
          component: 'http',
          statusCode: status,
          errorCode: status === 500 ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST',
        })
        if (res.headersSent) {
          res.destroy()
          return
        }
        res.status(status).json({
          error:
            status === 500 ? 'Request unavailable. Please try again shortly.' : 'Invalid request',
        })
      },
    )
    return app
  } catch (error) {
    await server.stop().catch(() => undefined)
    throw error
  }
}
