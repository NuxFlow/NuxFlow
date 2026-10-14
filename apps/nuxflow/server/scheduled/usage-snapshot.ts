import { useDb } from '../utils/db'
import { contentItems, dynamicPlugins, media, sites, userSiteRoles } from '@nuxflow/db/schema'
import { count, sql } from 'drizzle-orm'
import { usageDay, writeUsageSnapshot, type UsageCount, type UsageSnapshotMetric } from '../utils/usage'

// Roles that sign up or are added as audience, not staff — mirrors SELF_SERVE_ROLES in
// user-provisioning.ts.
const MEMBER_ROLES = ['member', 'viewer']

/**
 * Nightly totals per site (server/utils/usage.ts's snapshot metrics): storage, content
 * items, team and site members, plugins. One grouped query per metric for the whole
 * installation — a handful of D1 queries a night however many sites there are — then one
 * upsert per 20 rows. Every site gets a row for every metric, zeros included, so "nothing"
 * and "not measured" never look the same.
 */
export const snapshotUsage = async (now = new Date()) => {
  const db = useDb()
  const day = usageDay(now)

  const [siteRows, storage, items, roles, plugins] = await Promise.all([
    db.select({ id: sites.id }).from(sites),
    db.select({ siteId: media.siteId, value: sql<number>`coalesce(sum(${media.size}), 0)` }).from(media).groupBy(media.siteId),
    db.select({ siteId: contentItems.siteId, value: count() }).from(contentItems).groupBy(contentItems.siteId),
    db.select({
      siteId: userSiteRoles.siteId,
      members: sql<number>`sum(case when ${userSiteRoles.role} in ${MEMBER_ROLES} then 1 else 0 end)`,
      team: sql<number>`sum(case when ${userSiteRoles.role} in ${MEMBER_ROLES} then 0 else 1 end)`,
    }).from(userSiteRoles).groupBy(userSiteRoles.siteId),
    db.select({ siteId: dynamicPlugins.siteId, value: count() }).from(dynamicPlugins).groupBy(dynamicPlugins.siteId),
  ])

  const bySite = (rows: { siteId: string; value: number }[]) => new Map(rows.map(r => [r.siteId, Number(r.value)]))
  const values: Record<UsageSnapshotMetric, Map<string, number>> = {
    storage_bytes: bySite(storage),
    content_items: bySite(items),
    team_members: new Map(roles.map(r => [r.siteId, Number(r.team)])),
    site_members: new Map(roles.map(r => [r.siteId, Number(r.members)])),
    plugins: bySite(plugins),
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
