import { hashPassword } from 'better-auth/crypto'
import type Database from 'better-sqlite3'
import { and, count, desc, eq, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { account, adminMemberships, session, user } from '../../database/schema.js'
import { UserRole } from '../../graphql/generated/resolvers.js'
import { ValidationError } from '../../shared/errors.js'
import type { z } from 'zod'
import type { adminCustomersInputSchema } from './admin.validation.js'

type CustomerInput = z.infer<typeof adminCustomersInputSchema>

function createdAtIso(value: Date | number) {
  const date = value instanceof Date ? value : new Date(value)
  return date.toISOString()
}

export function createAdminRepository(db: Database.Database) {
  const orm = drizzle(db)
  const customerSelect = {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    membershipUserId: adminMemberships.userId,
  }
  const joined = () =>
    orm
      .select(customerSelect)
      .from(user)
      .leftJoin(adminMemberships, eq(adminMemberships.userId, user.id))
  const present = (
    row:
      | {
          id: string
          name: string
          email: string
          createdAt: Date
          membershipUserId: string | null
        }
      | undefined,
  ) => {
    if (!row) throw new ValidationError('User was not found')
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.membershipUserId ? UserRole.Admin : UserRole.Customer,
      createdAt: createdAtIso(row.createdAt),
    }
  }
  const filters = (input: CustomerInput) => {
    const pattern = `%${input.search.replace(/[\\%_]/g, '\\$&')}%`
    const text: SQL | undefined = input.search
      ? or(
          sql`${user.name} LIKE ${pattern} ESCAPE '\\'`,
          sql`${user.email} LIKE ${pattern} ESCAPE '\\'`,
        )
      : undefined
    const role =
      input.role === 'ADMIN'
        ? isNotNull(adminMemberships.userId)
        : input.role === 'CUSTOMER'
          ? isNull(adminMemberships.userId)
          : undefined
    return and(text, role)
  }
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
    getCustomer(userId: string) {
      return present(joined().where(eq(user.id, userId)).get())
    },
    async resetCustomerPassword(userId: string, newPassword: string) {
      if (!orm.select({ id: user.id }).from(user).where(eq(user.id, userId)).get()) {
        throw new ValidationError('User was not found')
      }
      const credential = orm
        .select({ id: account.id })
        .from(account)
        .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
        .get()
      if (!credential) throw new ValidationError('This account has no password.')
      const hashed = await hashPassword(newPassword)
      orm.transaction((tx) => {
        const updated = tx
          .update(account)
          .set({ password: hashed, updatedAt: new Date() })
          .where(eq(account.id, credential.id))
          .run()
        if (updated.changes !== 1) throw new ValidationError('This account has no password.')
        tx.delete(session).where(eq(session.userId, userId)).run()
      })
    },
    listCustomers(input: CustomerInput) {
      const where = filters(input)
      return {
        total: orm
          .select({ n: count() })
          .from(user)
          .leftJoin(adminMemberships, eq(adminMemberships.userId, user.id))
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
