import { and, eq, type AnyColumn } from 'drizzle-orm'

/**
 * WHERE clause scoping a row by its own id plus the current site — the shape every
 * per-resource mutation route needs for its update()/delete() call, after an
 * `*OrThrow` lookup (see resource-queries.ts / content-queries.ts) already confirmed
 * the same two columns match.
 */
export function scopedById(idColumn: AnyColumn, id: string, siteIdColumn: AnyColumn, siteId: string) {
  return and(eq(idColumn, id), eq(siteIdColumn, siteId))
}
