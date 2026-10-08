import express from 'express'
import { isIP } from 'node:net'
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
  options: AuthOptions,
  paymentOptions: Omit<PaymentOptions, 'frontendOrigin'> = {},
) {
  const payments = createPaymentService(
    createPaymentRepository(db, paymentOptions.now ?? Date.now),
    {
      ...paymentOptions,
      frontendOrigin: options.frontendOrigin,
    },
  )
  const auth = createAuth(db, options)
  const server = new ApolloServer<GraphQLContext>({
    typeDefs,
    resolvers: createResolvers(db, payments),
    formatError: publicGraphQLError,
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
    app.get('/health', (_req, res) => res.json({ status: 'ok' }))
    app.locals.payments = payments
    app.locals.close = () => server.stop()
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
          res.sendStatus(400)
          return
        }
        try {
          await payments.handleEvent(event)
          res.sendStatus(200)
        } catch {
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
          const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
          return { user: session?.user ?? null }
        },
      }),
    )
    return app
  } catch (error) {
    await server.stop().catch(() => undefined)
    throw error
  }
}
