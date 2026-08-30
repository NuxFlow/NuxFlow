import { useDb } from '../utils/db'
import { contentItems } from '@nuxflow/db/schema'
import { and, count, eq, lte, sql } from 'drizzle-orm'

export const publishScheduled = async () => {
  const db = useDb()

  const where = and(
    eq(contentItems.status, 'scheduled'),
    lte(contentItems.scheduledAt, sql`(datetime('now'))`),
  )

  const [row] = await db.select({ value: count() }).from(contentItems).where(where)
  const due = row?.value ?? 0

  if (due > 0) {
    await db.update(contentItems)
      .set({ status: 'published', publishedAt: sql`(datetime('now'))` })
      .where(where)
  }

  return { published: due }
}
