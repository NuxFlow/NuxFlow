import { useDb } from '../utils/db'
import { comments, contentItems, contentRevisions, dynamicPlugins, emailMessages, formSubmissions, media, pluginStorage, sites, userSiteRoles } from '@nuxflow/db/schema'
import { count, eq, sql } from 'drizzle-orm'
import type { Db } from '../utils/db'
import { writeUsageSnapshot, type UsageCount, type UsageSnapshotMetric } from '../utils/usage'
import { utcDay } from '../utils/utc-day'

// Same split as hosting-plans.ts's team/member limits: `member` is audience, every other
// role is team — except super_admin, the platform operator's own grant.
const MEMBER_ROLE = 'member'
const OPERATOR_ROLE = 'super_admin'

/**
 * Approximate bytes each site takes in the shared D1 database: the big text columns of the
 * tables that grow with use — content and its revisions, media rows (the database fallback
 * keeps whole files there), inbox bodies, form entries, comments and plugin storage. Not an
 * exact on-disk size (D1 doesn't expose one per tenant — see d1-stats.ts), but the same
 * method every night, so it shows which sites are growing and roughly by how much.
 */
async function databaseBytesBySite(db: Db): Promise<Map<string, number>> {
  const len = (col: unknown) => sql<number>`coalesce(sum(length(${col})), 0)`
  const parts = await Promise.all([
    db.select({ siteId: contentItems.siteId, value: len(contentItems.content) }).from(contentItems).groupBy(contentItems.siteId),
    db.select({ siteId: contentItems.siteId, value: len(contentRevisions.content) }).from(contentRevisions)
      .innerJoin(contentItems, eq(contentItems.id, contentRevisions.itemId)).groupBy(contentItems.siteId),
    db.select({ siteId: media.siteId, value: len(media.url) }).from(media).groupBy(media.siteId),
    db.select({ siteId: emailMessages.siteId, value: sql<number>`coalesce(sum(length(${emailMessages.textBody})), 0) + coalesce(sum(length(${emailMessages.htmlBody})), 0)` })
      .from(emailMessages).groupBy(emailMessages.siteId),
    db.select({ siteId: formSubmissions.siteId, value: len(formSubmissions.data) }).from(formSubmissions).groupBy(formSubmissions.siteId),
    db.select({ siteId: comments.siteId, value: len(comments.body) }).from(comments).groupBy(comments.siteId),
    db.select({ siteId: pluginStorage.siteId, value: len(pluginStorage.value) }).from(pluginStorage).groupBy(pluginStorage.siteId),
  ])
  const totals = new Map<string, number>()
  for (const rows of parts) {
    for (const r of rows) totals.set(r.siteId, (totals.get(r.siteId) ?? 0) + Number(r.value))
  }
  return totals
}

/**
 * Nightly totals per site (server/utils/usage.ts's snapshot metrics): storage, content
 * items, team and site members, plugins, database size. One grouped query per metric for the whole
 * installation — a handful of D1 queries a night however many sites there are — then one
 * upsert per 20 rows. Every site gets a row for every metric, zeros included, so "nothing"
 * and "not measured" never look the same.
 */
export const snapshotUsage = async (now = new Date()) => {
  const db = useDb()
  const day = utcDay(now)

  const [siteRows, storage, emailStorage, items, roles, plugins, database] = await Promise.all([
    db.select({ id: sites.id }).from(sites),
    db.select({ siteId: media.siteId, value: sql<number>`coalesce(sum(${media.size}), 0)` }).from(media).groupBy(media.siteId),
    // Inbound email kept in R2 counts towards storage too (hosting-plans.ts).
    db.select({ siteId: emailMessages.siteId, value: sql<number>`coalesce(sum(${emailMessages.storedBytes}), 0)` }).from(emailMessages).groupBy(emailMessages.siteId),
    db.select({ siteId: contentItems.siteId, value: count() }).from(contentItems).groupBy(contentItems.siteId),
    db.select({
      siteId: userSiteRoles.siteId,
      members: sql<number>`sum(case when ${userSiteRoles.role} = ${MEMBER_ROLE} then 1 else 0 end)`,
      team: sql<number>`sum(case when ${userSiteRoles.role} in (${MEMBER_ROLE}, ${OPERATOR_ROLE}) then 0 else 1 end)`,
    }).from(userSiteRoles).groupBy(userSiteRoles.siteId),
    db.select({ siteId: dynamicPlugins.siteId, value: count() }).from(dynamicPlugins).groupBy(dynamicPlugins.siteId),
    databaseBytesBySite(db),
  ])

  const bySite = (rows: { siteId: string; value: number }[]) => new Map(rows.map(r => [r.siteId, Number(r.value)]))
  const addUp = (a: Map<string, number>, b: Map<string, number>) => {
    const out = new Map(a)
    for (const [id, n] of b) out.set(id, (out.get(id) ?? 0) + n)
    return out
  }
  const values: Record<UsageSnapshotMetric, Map<string, number>> = {
    storage_bytes: addUp(bySite(storage), bySite(emailStorage)),
    content_items: bySite(items),
    team_members: new Map(roles.map(r => [r.siteId, Number(r.team)])),
    site_members: new Map(roles.map(r => [r.siteId, Number(r.members)])),
    plugins: bySite(plugins),
    database_bytes: database,
  }

  const rows: UsageCount[] = siteRows.flatMap(site =>
    (Object.keys(values) as UsageSnapshotMetric[]).map(metric => ({
      siteId: site.id,
      day,
      metric,
      value: values[metric].get(site.id) ?? 0,
    })),
  )
  await writeUsageSnapshot(db, rows)
  return { sites: siteRows.length, rows: rows.length }
}
