import { useDb } from '../utils/db'
import { contentItems } from '@nuxflow/db/schema'
import { and, eq, lte, sql } from 'drizzle-orm'

export const publishScheduled = async () => {
  const db = useDb()

  const due = await db.query.contentItems.findMany({
    where: and(
      eq(contentItems.status, 'scheduled'),
      lte(contentItems.scheduledAt, sql`(datetime('now'))`),
    ),
    columns: { id: true },
  })

  for (const item of due) {
    await db.update(contentItems)
      .set({ status: 'published', publishedAt: sql`(datetime('now'))` })
      .where(eq(contentItems.id, item.id))
  }

  return { published: due.length }
}
