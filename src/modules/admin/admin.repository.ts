import { hashPassword } from 'better-auth/crypto'
import type Database from 'better-sqlite3'
import { and, count, desc, eq, or, sql, type SQL } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { account, userRoles, session, user } from '../../database/schema.js'
import { UserRole } from '../../graphql/generated/resolvers.js'
import { ValidationError } from '../../shared/errors.js'
import type { z } from 'zod'
import type { adminUsersInputSchema } from './admin.validation.js'
import type { ActivityActor } from '../activity/activity.types.js'
import { insertActivity } from '../activity/activity.writer.js'

type UserInput = z.infer<typeof adminUsersInputSchema>

function createdAtIso(value: Date | number) {
  const date = value instanceof Date ? value : new Date(value)
  return date.toISOString()
}

export function createAdminRepository(db: Database.Database) {
  const orm = drizzle(db)
  const userSelect = {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    role: userRoles.role,
  }
  const joined = () =>
    orm.select(userSelect).from(user).leftJoin(userRoles, eq(userRoles.userId, user.id))
  const present = (
    row:
      | {
          id: string
          name: string
          email: string
          createdAt: Date
          role: 'CUSTOMER' | 'STAFF' | 'ADMIN' | null
        }
      | undefined,
  ) => {
    if (!row) throw new ValidationError('User was not found')
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      role:
        row.role === 'ADMIN'
          ? UserRole.Admin
          : row.role === 'STAFF'
            ? UserRole.Staff
            : UserRole.Customer,
      createdAt: createdAtIso(row.createdAt),
    }
  }
  const filters = (input: UserInput) => {
    const pattern = `%${input.search.replace(/[\\%_]/g, '\\$&')}%`
    const text: SQL | undefined = input.search
      ? or(
          sql`${user.name} LIKE ${pattern} ESCAPE '\\'`,
          sql`${user.email} LIKE ${pattern} ESCAPE '\\'`,
        )
      : undefined
    const role =
      input.role === 'ALL'
        ? undefined
        : sql`coalesce(${userRoles.role}, 'CUSTOMER') = ${input.role}`
    return and(text, role)
  }
  const getUserRole = (userId: string) =>
    orm.select().from(userRoles).where(eq(userRoles.userId, userId)).get()?.role ?? 'CUSTOMER'
  const setUserRole = (
    userId: string,
    role: 'CUSTOMER' | 'STAFF' | 'ADMIN',
    actor: ActivityActor,
  ): void => {
    orm.transaction((tx) => {
      const target = tx.select({ name: user.name }).from(user).where(eq(user.id, userId)).get()
      if (!target) throw new ValidationError('User was not found')
      const before =
        tx.select().from(userRoles).where(eq(userRoles.userId, userId)).get()?.role ?? 'CUSTOMER'
      tx.insert(userRoles)
        .values({ userId, role })
        .onConflictDoUpdate({ target: userRoles.userId, set: { role } })
        .run()
      if (before !== role)
        insertActivity(tx, actor, {
          action: 'USER_ROLE_CHANGED',
          targetType: 'USER',
          targetId: userId,
          targetName: target.name,
          changes: [{ field: 'ROLE', before, after: role }],
        })
    })
  }
  return {
    getUserRole,
    setUserRole,
    getActivityActor(userId: string): ActivityActor {
      const actor = orm.select({ name: user.name }).from(user).where(eq(user.id, userId)).get()
      if (!actor) throw new ValidationError('User was not found')
      return { source: 'GRAPHQL', userId, name: actor.name, role: getUserRole(userId) }
    },
    isAdmin(userId: string): boolean {
      return getUserRole(userId) === 'ADMIN'
    },
    setAdminAccess(userId: string, enabled: boolean, actor: ActivityActor): void {
      setUserRole(userId, enabled ? 'ADMIN' : 'CUSTOMER', actor)
    },
    getUser(userId: string) {
      return present(joined().where(eq(user.id, userId)).get())
    },
    async resetUserPassword(userId: string, newPassword: string, actor: ActivityActor) {
      const hashed = await hashPassword(newPassword)
      orm.transaction((tx) => {
        const target = tx.select({ name: user.name }).from(user).where(eq(user.id, userId)).get()
        if (!target) throw new ValidationError('User was not found')
        const credential = tx
          .select({ id: account.id })
          .from(account)
          .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
          .get()
        if (!credential) throw new ValidationError('This account has no password.')
        const updated = tx
          .update(account)
          .set({ password: hashed, updatedAt: new Date() })
          .where(eq(account.id, credential.id))
          .run()
        if (updated.changes !== 1) throw new ValidationError('This account has no password.')
        tx.delete(session).where(eq(session.userId, userId)).run()
        insertActivity(tx, actor, {
          action: 'USER_PASSWORD_RESET',
          targetType: 'USER',
          targetId: userId,
          targetName: target.name,
          changes: [],
        })
      })
    },
    listUsers(input: UserInput) {
      const where = filters(input)
      return {
        total: orm
          .select({ n: count() })
          .from(user)
          .leftJoin(userRoles, eq(userRoles.userId, user.id))
          .where(where)
          .get()!.n,
        items: joined()
          .where(where)
          .orderBy(desc(user.createdAt), desc(user.id))
          .limit(input.limit)
          .offset(input.offset)
          .all()
          .map((row) => present(row)),
      }
    },
  }
}
