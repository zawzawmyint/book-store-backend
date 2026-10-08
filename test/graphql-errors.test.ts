import { expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { createDatabase } from '../src/database/connection.js'

it.each(['{ books(search:"private-search-value") { total } }', '{ book(id:"1") { id } }'])(
  'masks unexpected database failures at the GraphQL boundary: %s',
  async (query) => {
    const database = createDatabase(':memory:')
    const app = await createApp(database, {
      frontendOrigin: 'http://localhost:5173',
      authBaseURL: 'http://localhost:5173',
      authSecret: 'graphql-error-secret-at-least-thirty-two-characters',
    })
    try {
      database.exec('DROP TABLE books')
      const response = await request(app).post('/graphql').send({ query })
      expect(response.body.errors[0]).toMatchObject({
        message: 'Request unavailable. Please try again shortly.',
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      })
      expect(JSON.stringify(response.body)).not.toMatch(
        /private-search-value|SELECT|select|params|stacktrace|no such table/,
      )
    } finally {
      await app.locals.close()
      database.close()
    }
  },
)
