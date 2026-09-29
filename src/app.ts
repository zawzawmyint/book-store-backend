import express from 'express'
import cors from 'cors'
import { ApolloServer } from '@apollo/server'
import { expressMiddleware } from '@as-integrations/express5'
import type Database from 'better-sqlite3'
import { createResolvers, typeDefs } from './graphql.js'

export async function createApp(
  db: Database.Database,
  options: { frontendOrigin: string } = { frontendOrigin: 'http://localhost:5173' },
) {
  const server = new ApolloServer({
    typeDefs,
    resolvers: createResolvers(db),
  })
  await server.start()
  const app = express()
  app.disable('x-powered-by')
  app.get('/health', (_req, res) => res.json({ status: 'ok' }))
  app.use(
    '/graphql',
    cors({ origin: options.frontendOrigin }),
    express.json({ limit: '100kb' }),
    expressMiddleware(server),
  )
  return app
}
