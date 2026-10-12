import type Database from 'better-sqlite3'
import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { createMailDispatcher, type EmailSender } from './modules/email/email.service.js'
import { authEmail } from './modules/email/email.content.js'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import * as authSchema from './database/auth-schema.js'
import * as postgresAuthSchema from './database/postgresql/auth-schema.js'
import { normalizeDatabaseHandle, type DatabaseHandle } from './database/runtime.js'
import { serializedSQLiteOrm } from './database/persistence.js'

export type AuthOptions = {
  authBaseURL: string
  authSecret: string
  frontendOrigin: string
  trustedProxyIp?: string
  emailSender?: EmailSender
}

export function createAuth(db: DatabaseHandle | Database.Database, options: AuthOptions) {
  const database = normalizeDatabaseHandle(db)
  const schema = database.provider === 'sqlite' ? authSchema : postgresAuthSchema
  const orm =
    database.provider === 'sqlite' ? serializedSQLiteOrm(database.raw, database.orm) : database.orm
  const limits = new Map<string, { count: number; start: number; expiresAt: number }>()
  const normalizeName = (name: string) => {
    const trimmed = name.trim()
    if (trimmed.length < 1 || trimmed.length > 120) {
      throw new APIError('BAD_REQUEST', { message: 'Name must contain 1 to 120 characters' })
    }
    return trimmed
  }

  const mail = createMailDispatcher(options.emailSender)
  const auth = betterAuth({
    database: drizzleAdapter(orm, {
      provider: database.provider === 'sqlite' ? 'sqlite' : 'pg',
      schema,
    }),
    baseURL: options.authBaseURL,
    secret: options.authSecret,
    trustedOrigins: [options.frontendOrigin],
    logger: { disabled: true },
    advanced: {
      ipAddress: { ipAddressHeaders: ['x-bookstore-client-ip'] },
      backgroundTasks: { handler: mail.track },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (
          [
            '/update-user',
            '/change-password',
            '/set-password',
            '/delete-user',
            '/list-sessions',
            '/revoke-session',
            '/revoke-sessions',
            '/revoke-other-sessions',
            '/change-email',
            '/list-accounts',
            '/account-info',
          ].includes(ctx.path)
        ) {
          const session = await getSessionFromCtx(ctx, { disableCookieCache: true })
          if (session && !session.user.emailVerified)
            throw new APIError('UNAUTHORIZED', { message: 'Email verification required' })
        }
        const callback = (path: string, carried: unknown) => {
          const result = new URL(path, options.frontendOrigin)
          try {
            const prior = new URL(String(carried), options.frontendOrigin)
            const target = prior.searchParams.get('returnTo')
            if (
              prior.origin === options.frontendOrigin &&
              target?.startsWith('/') &&
              !target.startsWith('//') &&
              !target.includes('\\') &&
              ![...target].some(
                (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
              ) &&
              ![
                '/sign-in',
                '/sign-up',
                '/check-email',
                '/verification-result',
                '/forgot-password',
                '/reset-password',
              ].includes(new URL(target, options.frontendOrigin).pathname.replace(/\/$/, ''))
            )
              result.searchParams.set('returnTo', target)
          } catch {
            /* Ignore invalid carried destinations. */
          }
          return result.toString()
        }
        const verification = callback(
          '/verification-result',
          ctx.body?.callbackURL ?? ctx.query?.callbackURL,
        )
        const reset = callback('/reset-password', ctx.body?.redirectTo ?? ctx.query?.callbackURL)
        if (['/sign-up/email', '/send-verification-email'].includes(ctx.path))
          ctx.body.callbackURL = verification
        if (ctx.path === '/request-password-reset') ctx.body.redirectTo = reset
        if (ctx.path === '/verify-email') {
          ctx.query ??= {}
          ctx.query.callbackURL = verification
        }
        if (ctx.path.startsWith('/reset-password/')) {
          ctx.query ??= {}
          ctx.query.callbackURL = reset
        }
      }),
    },
    rateLimit: {
      enabled: true,
      customRules: {
        '/send-verification-email': { window: 60, max: 1 },
        '/request-password-reset': { window: 300, max: 3 },
      },
      customStorage: {
        async consume(key, rule) {
          const now = Date.now()
          if (limits.size > 100_000) {
            for (const [storedKey, value] of limits) {
              if (now >= value.expiresAt) limits.delete(storedKey)
            }
            if (limits.size > 100_000) limits.delete(limits.keys().next().value!)
          }
          const prior = limits.get(key)
          if (!prior || now - prior.start >= rule.window * 1000) {
            limits.set(key, { count: 1, start: now, expiresAt: now + rule.window * 1000 })
            return { allowed: true, retryAfter: null }
          }
          if (prior.count >= rule.max) {
            return {
              allowed: false,
              retryAfter: Math.ceil((prior.start + rule.window * 1000 - now) / 1000),
            }
          }
          prior.count++
          return { allowed: true, retryAfter: null }
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => ({ data: { ...user, name: normalizeName(user.name) } }),
        },
        update: {
          before: async (user) => {
            if (user.image !== undefined) {
              throw new APIError('BAD_REQUEST', { message: 'Image cannot be updated' })
            }
            if (user.name === undefined) return undefined
            return { data: { ...user, name: normalizeName(user.name) } }
          },
        },
      },
    },
    emailVerification: {
      expiresIn: 3600,
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      afterEmailVerification: async (user) => {
        const context = await auth.$context
        await context.internalAdapter.deleteUserSessions(user.id)
      },
      sendVerificationEmail: async ({ user, url }) => {
        mail.send(authEmail(user.email, url, 'verify'))
      },
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: 3600,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        mail.send(authEmail(user.email, url, 'reset'))
      },
    },
  })
  return Object.assign(auth, { closeMail: mail.close })
}
