import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import type { Db } from './types'

/**
 * Bundles a count query with a rows query so a paginated list endpoint can't
 * silently omit `total` by forgetting the separate count round trip. Table- and
 * query-builder-agnostic on purpose — call sites differ between the relational
 * `db.query.x.findMany` API and the core `db.select().from()` API, and both
 * only need to hand this a `() => Promise<...>` thunk for each half.
 */
export async function paginate<T>(
  countQuery: () => Promise<Array<{ total: number }>>,
  rowsQuery: () => Promise<T[]>,
): Promise<{ items: T[]; total: number }> {
  const [countResult, items] = await Promise.all([countQuery(), rowsQuery()])
  return { items, total: countResult[0]?.total ?? 0 }
}

/**
 * Thunked row-count query for the `countQuery` half of `paginate()` — the
 * `db.select({ total: sql\`count(*)\` }).from(table).where(where)` one-liner
 * repeated verbatim at every paginated list route, differing only by table/where.
 */
export function countRows(db: Db, table: SQLiteTable, where: SQL | undefined) {
  return () => db.select({ total: sql<number>`count(*)` }).from(table).where(where)
}
