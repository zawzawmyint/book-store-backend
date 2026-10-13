import type Database from 'better-sqlite3'
import { normalizeDatabaseHandle, type DatabaseHandle } from './runtime.js'
import { log } from '../shared/logger.js'

export function createReadinessProbe(input: DatabaseHandle | Database.Database) {
  const database = normalizeDatabaseHandle(input)
  let pending: Promise<boolean> | undefined
  let lastResult: boolean | undefined
  return async function ready(): Promise<boolean> {
    // Keep the in-flight probe until the driver finishes, even after an HTTP
    // deadline. This bounds polling work to one query per application instance.
    if (!pending) {
      const probe = Promise.resolve()
        .then(async () => {
          if (database.provider === 'sqlite') database.raw.prepare('SELECT 1').get()
          else {
            // A client-side timeout also bounds a socket that never responds.
            // pool.query discards a client on a query read-timeout error.
            const query = { text: 'SELECT 1', query_timeout: 2000 }
            await database.pool.query(query)
          }
          return true
        })
        .catch(() => false)
      pending = probe
      void probe.then(() => {
        if (pending === probe) pending = undefined
      })
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const result = await Promise.race([
      pending,
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), 2000)
      }),
    ])
    clearTimeout(timer)
    if (result !== lastResult) {
      if (!result)
        log('error', 'readiness.unavailable', {
          component: 'database',
          errorCode: 'DATABASE_UNAVAILABLE',
        })
      else if (lastResult === false) log('info', 'readiness.recovered', { component: 'database' })
      lastResult = result
    }
    return result
  }
}
