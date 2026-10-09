import { and, eq, gte, lte, or, sql, type AnyColumn } from 'drizzle-orm'

// Portable expressions keep search semantics identical while concrete query
// builders/table definitions retain their own dialect types in each adapter.
// Explicit escaping is required for literal %, _ and backslash searches.
export function textSearch(search: string, ...columns: AnyColumn[]) {
  const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`
  return or(...columns.map((column) => sql`lower(${column}) LIKE lower(${pattern}) ESCAPE '\\'`))
}

export function stockAdjustment(stock: AnyColumn, delta: number) {
  const next = sql`${stock} + ${delta}`
  return { next, bounds: and(gte(next, 0), lte(next, 1000000)) }
}

export function orderSearch(
  search: string,
  id: AnyColumn,
  name: AnyColumn,
  email: AnyColumn,
  provider: 'sqlite' | 'postgresql' = 'postgresql',
) {
  const term = search.trim()
  if (!term) return undefined
  if (/^#?\d+$/.test(term)) {
    const value = Number(term.replace(/^#/, ''))
    // PostgreSQL order IDs are signed 32-bit integers; keep both providers equivalent.
    return Number.isSafeInteger(value) && value > 0 && value <= 2147483647
      ? eq(id, value)
      : sql`1 = 0`
  }
  if (provider === 'sqlite') {
    // SQLite's built-in lower() folds ASCII only; keep customer-name lookup Unicode aware.
    const pattern = `%${term.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`
    return or(
      ...[name, email].map((column) => sql`unicode_lower(${column}) LIKE ${pattern} ESCAPE '\\'`),
    )
  }
  return textSearch(term, name, email)
}
