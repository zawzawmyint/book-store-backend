import type Database from 'better-sqlite3'
import { count, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as sqliteSchema from './auth-schema.js'
import { serializeSQLite } from './persistence.js'
import { sampleBooks, seedBooks } from './seed.js'
import type { DatabaseHandle } from './runtime.js'

export type SeedDatabase = DatabaseHandle | Database.Database

export function createSeedAccountStore(input: SeedDatabase) {
  return {
    async findByEmail(email: string): Promise<{ id: string } | undefined> {
      if ('provider' in input && input.provider === 'postgresql') {
        const schema = await import('./postgresql/schema.js')
        const [row] = await input.orm
          .select({ id: schema.user.id })
          .from(schema.user)
          .where(eq(schema.user.email, email))
        return row
      }
      const raw = 'provider' in input ? input.raw : input
      return serializeSQLite(raw, async () =>
        drizzle(raw)
          .select({ id: sqliteSchema.user.id })
          .from(sqliteSchema.user)
          .where(eq(sqliteSchema.user.email, email))
          .get(),
      )
    },
    async deleteSessionToken(token: string): Promise<void> {
      if ('provider' in input && input.provider === 'postgresql') {
        const schema = await import('./postgresql/schema.js')
        await input.orm.delete(schema.session).where(eq(schema.session.token, token))
        return
      }
      const raw = 'provider' in input ? input.raw : input
      await serializeSQLite(raw, async () => {
        drizzle(raw).delete(sqliteSchema.session).where(eq(sqliteSchema.session.token, token)).run()
      })
    },
  }
}

// Seeding is provider composition/tooling, not a business-service query.
export async function seedRuntimeBooks(handle: DatabaseHandle): Promise<void> {
  if (handle.provider === 'sqlite') {
    seedBooks(handle.raw)
    return
  }
  const { books } = await import('./postgresql/schema.js')
  await handle.orm.transaction(async (tx) => {
    // Serialize explicit seed invocations without affecting application queries.
    const { sql } = await import('drizzle-orm')
    await tx.execute(sql`SELECT pg_advisory_xact_lock(730081)`)
    const [existing] = await tx.select({ count: count() }).from(books)
    if (existing.count > 0) return
    await tx.insert(books).values(sampleBooks)
  })
}
