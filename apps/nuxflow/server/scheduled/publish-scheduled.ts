import { useDb } from '../utils/db'
import { contentItems } from '@nuxflow/db/schema'
import { and, eq, lte, sql } from 'drizzle-orm'
import { dispatchWebhook } from '../utils/webhooks'

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('close', () => {})
})

// Cloudflare Cron Trigger handler — wire in wrangler.toml: [triggers] crons = ["* * * * *"]
export const publishScheduled = async () => {
  const db = useDb()

  const due = await db.query.contentItems.findMany({
    where: and(
      eq(contentItems.status, 'scheduled'),
      lte(contentItems.scheduledAt, sql`(datetime('now'))`),
    ),
    columns: { id: true, siteId: true, title: true },
  })

  for (const item of due) {
    await db.update(contentItems)
      .set({ status: 'published', publishedAt: sql`(datetime('now'))` })
      .where(eq(contentItems.id, item.id))

    await dispatchWebhook(item.siteId, 'content.publish', { id: item.id, title: item.title })
  }

  return { published: due.length }
}
