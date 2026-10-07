import type Database from 'better-sqlite3'
import { createAuth, type AuthOptions } from '../auth.js'
import { createAdminRepository } from '../modules/admin/admin.repository.js'
import { operatorActor } from '../modules/activity/activity.types.js'

export async function seedDemoAccounts(
  db: Database.Database,
  options: AuthOptions,
  nodeEnv: 'development' | 'test' | 'production',
) {
  if (nodeEnv === 'production') throw new Error('Demo accounts are disabled in production')
  const auth = createAuth(db, options)
  const roles = createAdminRepository(db)
  const demoRoles = ['CUSTOMER', 'STAFF', 'ADMIN'] as const
  const password = 'BookstoreDemo123!'
  const existingIds = new Map<string, string>()
  // Validate every reserved account before changing accounts or permissions.
  for (const role of demoRoles) {
    const email = `demo-${role.toLowerCase()}@example.com`
    const existing = db.prepare('SELECT id FROM user WHERE email = ?').get(email) as
      { id: string } | undefined
    if (existing) {
      try {
        const login = await auth.api.signInEmail({ body: { email, password } })
        db.prepare('DELETE FROM session WHERE token = ?').run(login.token)
        existingIds.set(email, existing.id)
      } catch {
        throw new Error(
          `Demo account ${email} already exists with different credentials; restore its demo password before seeding`,
        )
      }
    }
  }
  for (const role of demoRoles) {
    const email = `demo-${role.toLowerCase()}@example.com`
    let id = existingIds.get(email)
    if (!id) {
      const signup = await auth.api.signUpEmail({
        body: {
          name: `Demo ${role[0]}${role.slice(1).toLowerCase()}`,
          email,
          password,
        },
      })
      id = signup.user.id
      if (signup.token) db.prepare('DELETE FROM session WHERE token = ?').run(signup.token)
    }
    roles.setUserRole(id!, role, operatorActor)
  }
}
