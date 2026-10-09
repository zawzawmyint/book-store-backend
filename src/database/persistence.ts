import type Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { DatabaseHandle } from './runtime.js'
import type { DomainStore } from './store.types.js'
import { createSQLiteQueries } from './sqlite/store.js'
import { createPostgreSQLStore } from './postgresql/store.js'
export type DatabaseInput = DatabaseHandle | Database.Database | DomainStore
const stores = new WeakMap<object, DomainStore>()
const queues = new WeakMap<object, Promise<void>>()
export async function serializeSQLite<T>(
  raw: Database.Database,
  work: () => Promise<T>,
): Promise<T> {
  const previous = queues.get(raw) ?? Promise.resolve()
  let release!: () => void
  queues.set(
    raw,
    new Promise<void>((resolve) => {
      release = resolve
    }),
  )
  await previous
  try {
    return await work()
  } finally {
    release()
  }
}

// Better Auth also awaits Drizzle execution and uses transactional callbacks.
// Its queries must share the domain connection gate to avoid joining another
// request's unfinished transaction. Query construction itself remains synchronous.
export function serializedSQLiteOrm<T extends object>(raw: Database.Database, orm: T): T {
  function wrap<U extends object>(value: U, scoped: boolean, relational = false): U {
    return new Proxy(value, {
      get(target, key) {
        const member = Reflect.get(target, key)
        if (typeof member !== 'function') {
          if (member && typeof member === 'object' && (key === 'query' || relational))
            return wrap(member, scoped, true)
          return member
        }
        if (key === 'transaction')
          return (work: (tx: U) => Promise<unknown>) => {
            if (scoped) return work(wrap(target, true))
            return serializeSQLite(raw, async () => {
              raw.exec('BEGIN IMMEDIATE')
              try {
                const result = await work(wrap(target, true))
                raw.exec('COMMIT')
                return result
              } catch (error) {
                raw.exec('ROLLBACK')
                throw error
              }
            })
          }
        if (!scoped && key === 'execute')
          return (...args: unknown[]) =>
            serializeSQLite(raw, async () => Reflect.apply(member, target, args))
        if (!scoped && key === 'then')
          return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
            serializeSQLite(raw, async () => target).then(resolve, reject)
        return (...args: unknown[]) => {
          const result = Reflect.apply(member, target, args)
          return result && typeof result === 'object' ? wrap(result, scoped) : result
        }
      },
    })
  }
  return wrap(orm, false)
}

// One connection must never expose an unfinished asynchronous SQLite transaction
// to another request. Serialize both transaction scopes and independent operations.
function sqliteStore(raw: Database.Database): DomainStore {
  const cached = stores.get(raw)
  if (cached) return cached
  const queries = createSQLiteQueries(drizzle(raw))
  const scoped: DomainStore = { ...queries, transaction: (work) => work(scoped) }
  const store = new Proxy(queries, {
    get(target, key: keyof DomainStore) {
      if (key === 'transaction')
        return <T>(work: (scope: DomainStore) => Promise<T>) =>
          serializeSQLite(raw, async () => {
            raw.exec('BEGIN IMMEDIATE')
            try {
              const result = await work(scoped)
              raw.exec('COMMIT')
              return result
            } catch (error) {
              raw.exec('ROLLBACK')
              throw error
            }
          })
      const operation = target[key]
      if (key === 'dashboardWorkspace' || key === 'dashboardFinance')
        return (...args: unknown[]) =>
          serializeSQLite(raw, async () => {
            raw.exec('BEGIN')
            try {
              const result = await Reflect.apply(operation, target, args)
              raw.exec('COMMIT')
              return result
            } catch (error) {
              raw.exec('ROLLBACK')
              throw error
            }
          })
      return (...args: unknown[]) =>
        serializeSQLite(raw, () => Reflect.apply(operation, target, args))
    },
  })
  stores.set(raw, store)
  return store
}
export function normalizeStore(input: DatabaseInput): DomainStore {
  if ('book' in input) return input
  if ('provider' in input) {
    if (input.provider === 'sqlite') return sqliteStore(input.raw)
    const cached = stores.get(input.pool)
    if (cached) return cached
    const store = createPostgreSQLStore(input.orm)
    stores.set(input.pool, store)
    return store
  }
  return sqliteStore(input)
}
