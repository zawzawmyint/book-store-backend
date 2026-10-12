import type { SeedDatabase } from '../../database/runtime-seed.js'
import { normalizeDatabaseHandle } from '../../database/runtime.js'
import { serializeSQLite } from '../../database/persistence.js'
export async function revokeUnverifiedSessions(input: SeedDatabase, apply = false) {
  const db = normalizeDatabaseHandle(input)
  const counts =
    'SELECT (SELECT COUNT(*) FROM "user" WHERE email_verified = false) AS users, COUNT(*) AS sessions FROM session WHERE user_id IN (SELECT id FROM "user" WHERE email_verified = false)'
  const remove =
    'DELETE FROM session WHERE user_id IN (SELECT id FROM "user" WHERE email_verified = false)'
  if (db.provider === 'postgresql') {
    const client = await db.pool.connect()
    try {
      await client.query('BEGIN')
      const row = (await client.query(counts)).rows[0]
      const sessions = apply ? (await client.query(remove)).rowCount! : Number(row.sessions)
      await client.query('COMMIT')
      return { unverifiedUsers: Number(row.users), sessions }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
  return serializeSQLite(db.raw, async () =>
    db.raw.transaction(() => {
      const row = db.raw.prepare(counts).get() as { users: number; sessions: number }
      const sessions = apply ? db.raw.prepare(remove).run().changes : row.sessions
      return { unverifiedUsers: row.users, sessions }
    })(),
  )
}
