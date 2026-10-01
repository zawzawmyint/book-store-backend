import type Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import * as authSchema from './database/auth-schema.js'

export type AuthOptions = {
  authBaseURL: string
  authSecret: string
  frontendOrigin: string
  trustedProxyIp?: string
}

export function createAuth(db: Database.Database, options: AuthOptions) {
  const limits = new Map<string, { count: number; start: number; expiresAt: number }>()
  const normalizeName = (name: string) => {
    const trimmed = name.trim()
    if (trimmed.length < 1 || trimmed.length > 120) {
      throw new APIError('BAD_REQUEST', { message: 'Name must contain 1 to 120 characters' })
    }
    return trimmed
  }

  return betterAuth({
    database: drizzleAdapter(drizzle(db, { schema: authSchema }), {
      provider: 'sqlite',
      schema: authSchema,
    }),
    baseURL: options.authBaseURL,
    secret: options.authSecret,
    trustedOrigins: [options.frontendOrigin],
    advanced: { ipAddress: { ipAddressHeaders: ['x-bookstore-client-ip'] } },
    rateLimit: {
      enabled: true,
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
            return { allowed: false, retryAfter: Math.ceil((prior.start + rule.window * 1000 - now) / 1000) }
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
          before: async (user) =>
            user.name === undefined ? undefined : { data: { ...user, name: normalizeName(user.name) } },
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      requireEmailVerification: false,
    },
  })
}
