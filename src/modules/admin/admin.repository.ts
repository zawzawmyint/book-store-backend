import type Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { adminMemberships, user } from '../../database/schema.js'
import { ValidationError } from '../../shared/errors.js'

export function createAdminRepository(db: Database.Database) {
  const orm = drizzle(db)
  return {
    isAdmin(userId: string): boolean {
      return !!orm.select().from(adminMemberships).where(eq(adminMemberships.userId, userId)).get()
    },
    setAdminAccess(userId: string, enabled: boolean): void {
      if (!orm.select({ id: user.id }).from(user).where(eq(user.id, userId)).get()) {
        throw new ValidationError('User was not found')
      }
      if (enabled) orm.insert(adminMemberships).values({ userId }).onConflictDoNothing().run()
      else orm.delete(adminMemberships).where(eq(adminMemberships.userId, userId)).run()
    },
  }
}
