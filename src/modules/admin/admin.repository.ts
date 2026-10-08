import { hashPassword } from 'better-auth/crypto'
import { normalizeStore, type DatabaseInput } from '../../database/persistence.js'
import type { Role } from '../../database/store.types.js'
import { UserRole } from '../../graphql/generated/resolvers.js'
import { ValidationError } from '../../shared/errors.js'
import type { z } from 'zod'
import type { adminUsersInputSchema } from './admin.validation.js'
import type { ActivityActor } from '../activity/activity.types.js'
import { insertActivity } from '../activity/activity.writer.js'
export function createAdminRepository(input: DatabaseInput) {
  const store = normalizeStore(input)
  async function setUserRole(userId: string, role: Role, actor: ActivityActor) {
    await store.transaction(async (tx) => {
      const target = await tx.user(userId)
      if (!target) throw new ValidationError('User was not found')
      const before = await tx.role(userId)
      await tx.setRole(userId, role)
      if (before !== role)
        await insertActivity(tx, actor, {
          action: 'USER_ROLE_CHANGED',
          targetType: 'USER',
          targetId: userId,
          targetName: target.name,
          changes: [{ field: 'ROLE', before, after: role }],
        })
    })
  }
  function present(
    row:
      { id: string; name: string; email: string; createdAt: Date; role: Role | null } | undefined,
  ) {
    if (!row) throw new ValidationError('User was not found')
    return {
      ...row,
      role:
        row.role === 'ADMIN'
          ? UserRole.Admin
          : row.role === 'STAFF'
            ? UserRole.Staff
            : UserRole.Customer,
      createdAt: row.createdAt.toISOString(),
    }
  }
  return {
    getUserRole: (id: string) => store.role(id),
    setUserRole,
    async getActivityActor(userId: string): Promise<ActivityActor> {
      const actor = await store.user(userId)
      if (!actor) throw new ValidationError('User was not found')
      return { source: 'GRAPHQL', userId, name: actor.name, role: await store.role(userId) }
    },
    async isAdmin(userId: string) {
      return (await store.role(userId)) === 'ADMIN'
    },
    setAdminAccess(userId: string, enabled: boolean, actor: ActivityActor) {
      return setUserRole(userId, enabled ? 'ADMIN' : 'CUSTOMER', actor)
    },
    async getUser(userId: string) {
      const row = await store.user(userId)
      return present(row ? { ...row, role: await store.role(userId) } : undefined)
    },
    async resetUserPassword(userId: string, newPassword: string, actor: ActivityActor) {
      const hash = await hashPassword(newPassword)
      await store.transaction(async (tx) => {
        const target = await tx.user(userId)
        if (!target) throw new ValidationError('User was not found')
        const credential = await tx.credential(userId)
        if (!credential || !(await tx.password(credential.id, hash)))
          throw new ValidationError('This account has no password.')
        await tx.revokeSessions(userId)
        await insertActivity(tx, actor, {
          action: 'USER_PASSWORD_RESET',
          targetType: 'USER',
          targetId: userId,
          targetName: target.name,
          changes: [],
        })
      })
    },
    async listUsers(input: z.infer<typeof adminUsersInputSchema>) {
      const page = await store.users(input)
      return { total: page.total, items: page.items.map(present) }
    },
  }
}
