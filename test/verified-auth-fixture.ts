import type { Express } from 'express'
import type Database from 'better-sqlite3'
import request from 'supertest'
import { createAuth, type AuthOptions } from '../src/auth.js'
// Explicit synthetic account fixture: product sign-up remains unverified.
export function verifiedFixtureRequest(app: Express, db: Database.Database, options: AuthOptions) {
  const client = request(app)
  const post = client.post.bind(client)
  client.post = ((path: string) => {
    const outgoing = post(path)
    if (path !== '/api/auth/sign-up/email') return outgoing
    const send = outgoing.send.bind(outgoing)
    outgoing.send = (async (body: Record<string, string>) => {
      const response = await send(body)
      if (response.status === 200 && response.body.user?.id) {
        db.prepare('UPDATE user SET email_verified = 1 WHERE id = ?').run(response.body.user.id)
        const login = await createAuth(db, options).api.signInEmail({
          asResponse: true,
          body: { email: body.email, password: body.password },
        })
        response.headers['set-cookie'] = login.headers.getSetCookie()
      }
      return response
    }) as unknown as typeof outgoing.send
    return outgoing
  }) as typeof client.post
  return client
}
export const capturedFixtureSender = { async send() {} }
