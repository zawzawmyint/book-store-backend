import { expect, it } from 'vitest'
import { createDatabase } from '../src/database/connection.js'
import { createAuth } from '../src/auth.js'
import { createSeedAccountStore } from '../src/database/runtime-seed.js'
import { revokeUnverifiedSessions } from '../src/modules/auth-email/session-rollout.js'
it('previews unverified sessions then revokes only those while preserving identities and roles', async () => {
  const db = createDatabase(':memory:')
  try {
    const options = {
      frontendOrigin: 'http://localhost:5173',
      authBaseURL: 'http://localhost:5173',
      authSecret: 'rollout-test-secret-at-least-thirty-two-characters',
      emailSender: { async send() {} },
    }
    const auth = createAuth(db, options)
    for (const email of ['old@example.com', 'verified@example.com']) {
      const signup = await auth.api.signUpEmail({
        body: { name: 'Reader', email, password: 'rollout-password-123' },
      })
      await createSeedAccountStore(db).markVerified(signup.user.id)
      await auth.api.signInEmail({ body: { email, password: 'rollout-password-123' } })
    }
    db.prepare("UPDATE user SET email_verified = 0 WHERE email = 'old@example.com'").run()
    const users = db.prepare('SELECT * FROM user ORDER BY id').all()
    expect(await revokeUnverifiedSessions(db)).toEqual({ unverifiedUsers: 1, sessions: 1 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM session').get()).toEqual({ count: 2 })
    expect(await revokeUnverifiedSessions(db, true)).toEqual({ unverifiedUsers: 1, sessions: 1 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM session').get()).toEqual({ count: 1 })
    expect(db.prepare('SELECT * FROM user ORDER BY id').all()).toEqual(users)
  } finally {
    db.close()
  }
})
