import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { getCrawlerActivity } from '../../../utils/crawler-tracking'
import { blockedCrawlerTokens, getSeoSettings, KNOWN_CRAWLERS } from '../../../utils/seo'

const querySchema = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) })

/** Admin → SEO → AI & crawlers: who's been crawling (crawler_hits) and what's blocked. */
export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const { days } = await parseQuery(event, querySchema)
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const [seo, activity] = await Promise.all([getSeoSettings(db, siteId), getCrawlerActivity(db, siteId, days)])
  const blocked = new Set(blockedCrawlerTokens(seo.aiCrawlers))

  return {
    days,
    since: activity.since,
    daily: activity.daily,
    bots: activity.bots.map(b => ({ ...b, blocked: blocked.has(b.bot) })),
    registry: KNOWN_CRAWLERS.map(c => ({ token: c.token, owner: c.owner, category: c.category, legacy: Boolean(c.legacy), blocked: blocked.has(c.token) })),
  }
})
