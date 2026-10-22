import { z } from 'zod'
import { and, desc, eq, gte, inArray, or, sql } from 'drizzle-orm'
import { mailingListSubscribers, siteUsageDaily } from '@nuxflow/db/schema'
import { paginate, countRows } from '@nuxflow/db/queries'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { parsePagination } from '../../../utils/pagination'
import { loadEmailConfig } from '../../../utils/email'
import { usageDay } from '../../../utils/usage'
import { canSendListEmail, subscriberCounts } from '../../../utils/mailing-list'
import { requireSiteId } from '../../../utils/site-context'

const querySchema = z.object({
  status: z.enum(['pending', 'subscribed', 'unsubscribed']).optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
})

const STATS_DAYS = 30

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const query = parseQuery(event, querySchema)
  const { page, perPage, limit, offset } = parsePagination(query)

  // '!' as the LIKE escape character, so % and _ typed in the search box match literally.
  const search = query.q ? `%${query.q.toLowerCase().replace(/[!%_]/g, '!$&')}%` : null
  const where = and(
    eq(mailingListSubscribers.siteId, siteId),
    query.status ? eq(mailingListSubscribers.status, query.status) : undefined,
    search
      ? or(
          sql`${mailingListSubscribers.email} LIKE ${search} ESCAPE '!'`,
          sql`lower(${mailingListSubscribers.name}) LIKE ${search} ESCAPE '!'`,
        )
      : undefined,
  )

  const since = new Date(Date.now() - STATS_DAYS * 86_400_000)
  const [{ items, total }, counts, emailConfig, usageRows, popupSignups] = await Promise.all([
    paginate(
      countRows(db, mailingListSubscribers, where),
      () => db.select({
        id: mailingListSubscribers.id,
        email: mailingListSubscribers.email,
        name: mailingListSubscribers.name,
        status: mailingListSubscribers.status,
        source: mailingListSubscribers.source,
        sourcePath: mailingListSubscribers.sourcePath,
        confirmSentAt: mailingListSubscribers.confirmSentAt,
        confirmedAt: mailingListSubscribers.confirmedAt,
        unsubscribedAt: mailingListSubscribers.unsubscribedAt,
        syncError: mailingListSubscribers.syncError,
        createdAt: mailingListSubscribers.createdAt,
      }).from(mailingListSubscribers).where(where)
        .orderBy(desc(mailingListSubscribers.createdAt)).limit(limit).offset(offset),
    ),
    subscriberCounts(event, siteId),
    loadEmailConfig(event),
    db.select({ metric: siteUsageDaily.metric, total: sql<number>`sum(${siteUsageDaily.value})` })
      .from(siteUsageDaily)
      .where(and(
        eq(siteUsageDaily.siteId, siteId),
        inArray(siteUsageDaily.metric, ['signup_prompt_shown', 'signup_prompt_dismissed']),
        gte(siteUsageDaily.day, usageDay(since)),
      ))
      .groupBy(siteUsageDaily.metric),
    db.select({ total: sql<number>`count(*)` }).from(mailingListSubscribers).where(and(
      eq(mailingListSubscribers.siteId, siteId),
      eq(mailingListSubscribers.source, 'popup'),
      gte(mailingListSubscribers.createdAt, since.toISOString().slice(0, 19).replace('T', ' ')),
    )),
  ])

  const usage = Object.fromEntries(usageRows.map(r => [r.metric, Number(r.total)]))
  return {
    items,
    total,
    page,
    perPage,
    counts,
    canSendListEmail: canSendListEmail(emailConfig),
    stats: {
      days: STATS_DAYS,
      shown: usage.signup_prompt_shown ?? 0,
      dismissed: usage.signup_prompt_dismissed ?? 0,
      signups: Number(popupSignups[0]?.total ?? 0),
    },
  }
})
