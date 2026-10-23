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
import { log } from './shared/logger.js'
import {
  createAuthRateLimiter,
  AuthRateLimitUnavailable,
} from './modules/auth-email/auth-rate-limit.js'
import type { AuthRateLimitConfig } from './modules/auth-email/auth-rate-limit.config.js'

export type AuthOptions = {
  authBaseURL: string
  authSecret: string
  frontendOrigin: string
  trustedProxyIp?: string
  authRateLimit?: AuthRateLimitConfig
  emailSender?: EmailSender
  enqueueAuthEmail?: (input: {
    kind: 'VERIFY_EMAIL' | 'RESET_PASSWORD'
    userId: string
    to: string
    url: string
    token: string
  }) => Promise<unknown>
}

export function createAuth(db: DatabaseHandle | Database.Database, options: AuthOptions) {
  const database = normalizeDatabaseHandle(db)
  const schema = database.provider === 'sqlite' ? authSchema : postgresAuthSchema
  const orm =
    database.provider === 'sqlite' ? serializedSQLiteOrm(database.raw, database.orm) : database.orm
  const normalizeName = (name: string) => {
    const trimmed = name.trim()
    if (trimmed.length < 1 || trimmed.length > 120) {
      throw new APIError('BAD_REQUEST', { message: 'Name must contain 1 to 120 characters' })
    }
    return trimmed
  }

  const mail = createMailDispatcher(options.emailSender)
  const resetRequestStarts = new WeakMap<Request, number>()
  const sendAuthEmail = async (
    kind: 'VERIFY_EMAIL' | 'RESET_PASSWORD',
    user: { id: string; email: string },
    url: string,
    token: string,
  ) => {
    if (!options.enqueueAuthEmail) {
      mail.send(authEmail(user.email, url, kind === 'VERIFY_EMAIL' ? 'verify' : 'reset'))
      return
    }
    try {
      // Better Auth owns issuance. Await durable recording, but these writes do
      // not share its token/user transaction. A failed insert needs resend/reset.
      await options.enqueueAuthEmail({ kind, userId: user.id, to: user.email, url, token })
    } catch {
      // Preserve the same public response for existing and unknown accounts.
      // Never expose database errors, supplied tokens, links or recipients.
      log('error', 'email.auth_record_failed', {
        component: 'email',
        errorCode: 'EMAIL_AUTH_RECORD_FAILED',
      })
    }
  }
  const limiter = createAuthRateLimiter(
    options.authRateLimit ?? { store: 'memory' },
    options.authSecret,
  )
  try {
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
        ...(options.enqueueAuthEmail ? {} : { backgroundTasks: { handler: mail.track } }),
      },
      hooks: {
        before: createAuthMiddleware(async (ctx) => {
          if (options.enqueueAuthEmail && ctx.path === '/request-password-reset' && ctx.request)
            resetRequestStarts.set(ctx.request, performance.now())
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
        after: createAuthMiddleware(async (ctx) => {
          if (options.enqueueAuthEmail && ctx.path === '/request-password-reset' && ctx.request) {
            const started = resetRequestStarts.get(ctx.request)
            if (started !== undefined) {
              resetRequestStarts.delete(ctx.request)
              const remaining = 500 - (performance.now() - started)
              if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))
            }
          }
        }),
      },
      rateLimit: {
        enabled: true,
        customRules: {
          '/send-verification-email': { window: 60, max: 1 },
          '/request-password-reset': { window: 300, max: 3 },
        },
        customStorage: { consume: limiter.consume },
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
        sendVerificationEmail: async ({ user, url, token }) => {
          await sendAuthEmail('VERIFY_EMAIL', user, url, token)
        },
      },
      emailAndPassword: {
        enabled: true,
        autoSignIn: false,
        requireEmailVerification: true,
        resetPasswordTokenExpiresIn: 3600,
        revokeSessionsOnPasswordReset: true,
        sendResetPassword: async ({ user, url, token }) => {
          await sendAuthEmail('RESET_PASSWORD', user, url, token)
        },
      },
    })
    // Better Auth invokes custom storage before its endpoint error boundary.
    const handler = async (request: Request) => {
      try {
        return await auth.handler(request)
      } catch (error) {
        if (!(error instanceof AuthRateLimitUnavailable)) throw error
        return Response.json(
          {
            code: 'AUTH_RATE_LIMIT_UNAVAILABLE',
            message: 'Authentication is temporarily unavailable. Please try again shortly.',
          },
          { status: 503, headers: { 'Retry-After': '5', 'Cache-Control': 'no-store' } },
        )
      }
    }
    return {
      ...auth,
      handler,
      fetch: handler,
      checkRateLimit: limiter.check,
      closeMail: async () => {
        limiter.close()
        await mail.close()
      },
    }
  } catch (error) {
    limiter.close()
    throw error
  }
}
