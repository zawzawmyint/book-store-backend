import { createSeedAccountStore, type SeedDatabase } from './runtime-seed.js'
import { createAuth, type AuthOptions } from '../auth.js'
import { createAdminRepository } from '../modules/admin/admin.repository.js'
import { operatorActor } from '../modules/activity/activity.types.js'

export async function seedDemoAccounts(
  db: SeedDatabase,
  options: AuthOptions,
  nodeEnv: 'development' | 'test' | 'production',
) {
  if (nodeEnv === 'production') throw new Error('Demo accounts are disabled in production')
  const auth = createAuth(db, options)
  const roles = createAdminRepository(db)
  const accounts = createSeedAccountStore(db)
  const demoRoles = ['CUSTOMER', 'STAFF', 'ADMIN'] as const
  const password = 'BookstoreDemo123!'
  const existingIds = new Map<string, string>()
  // Validate every reserved account before changing accounts or permissions.
  for (const role of demoRoles) {
    const email = `demo-${role.toLowerCase()}@example.com`
    const existing = await accounts.findByEmail(email)
    if (existing) {
      try {
        const login = await auth.api.signInEmail({ body: { email, password } })
        await accounts.deleteSessionToken(login.token)
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
      if (signup.token) await accounts.deleteSessionToken(signup.token)
    }
    await roles.setUserRole(id!, role, operatorActor)
  }
}
