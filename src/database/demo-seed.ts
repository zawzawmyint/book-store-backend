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
  // Reserved local fixtures need no delivery, and never use production credentials.
  const auth = createAuth(db, { ...options, emailSender: { async send() {} } })
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
        const context = await auth.$context
        const credential = await context.internalAdapter.findCredentialAccount(existing.id)
        if (
          !credential?.password ||
          !(await context.password.verify({ hash: credential.password, password }))
        )
          throw new Error('Credential mismatch')
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
    await accounts.markVerified(id!)
    await roles.setUserRole(id!, role, operatorActor)
  }
}
