import express from 'express'
import { isIP } from 'node:net'
import cors from 'cors'
import { ApolloServer } from '@apollo/server'
import { expressMiddleware } from '@as-integrations/express5'
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node'
import type Database from 'better-sqlite3'
import { createAuth, type AuthOptions } from './auth.js'
import type { GraphQLContext } from './graphql/context.js'
import { createResolvers } from './graphql/resolvers.js'
import { typeDefs } from './graphql/schema.js'

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

export async function createApp(db: Database.Database, options: AuthOptions) {
  const auth = createAuth(db, options)
  const server = new ApolloServer<GraphQLContext>({
    typeDefs,
    resolvers: createResolvers(db),
  })
  await server.start()
  const app = express()
  app.disable('x-powered-by')
  app.get('/health', (_req, res) => res.json({ status: 'ok' }))
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
}
