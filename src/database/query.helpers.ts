import { and, gte, lte, or, sql, type AnyColumn } from 'drizzle-orm'

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
