import { and, eq, gte, isNotNull, max, sql } from 'drizzle-orm'
import { hostingPlans, notifications, sites, siteUsageDaily } from '@nuxflow/db/schema'
import { useDb } from '../utils/db'
import { createSystemEvent } from '../utils/system-event'
import { notifySiteRole } from '../utils/notify'
import { MONTHLY_METRIC, planMax, type HostingPlan } from '../utils/hosting-plans'
import { isHostingPlatform } from '../utils/hosting-platform'
import { PLAN_LIMITS } from '../../shared/lib/hosting-plan-limits'
import { getAiDailyCap, platformAiCreditsToday } from '../utils/ai-allowance'
import { utcDay } from '../utils/utc-day'

const THRESHOLDS = [100, 80] as const
// Every monthly limit, plus soft limits on totals (database size) — hard totals refuse the
// action itself and need no notice.
const ALERT_LIMITS = PLAN_LIMITS.filter(l => l.monthly || l.kind === 'soft')
const METRIC: Record<string, string> = { ...MONTHLY_METRIC, database: 'database_bytes' }

function formatAmount(unit: 'bytes' | 'count', n: number): string {
  if (unit === 'count') return n.toLocaleString('en')
  const mb = n / 1024 ** 2
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`
}

/**
 * Hourly: tells the platform operator (super admins of the primary site) when a site
 * reaches 80% or 100% of a monthly limit (or the soft database-size limit, read from the
 * latest nightly snapshot) on its hosting plan — once per site, limit, threshold and
 * month. For soft limits (views, renders, plugin requests, database) this is the only thing that
 * happens: a person decides what to do. Uses the notifications table itself as the
 * "already told" record, like stale-content-scan.ts.
 */
export const sendPlanUsageAlerts = async (now = new Date()) => {
  const db = useDb()
  if (!(await isHostingPlatform(db))) return { checked: 0, notified: 0 }
  const capNotified = await sendPlatformAiCapAlert(now)
  const month = utcDay(now).slice(0, 7)
  const monthStart = `${month}-01`

  const limited = await db.select({ site: { id: sites.id, name: sites.name, domain: sites.domain }, plan: hostingPlans })
    .from(sites)
    .innerJoin(hostingPlans, eq(hostingPlans.id, sites.hostingPlanId))
    .where(isNotNull(sites.hostingPlanId))
  if (!limited.length) return { checked: 0, notified: capNotified }

  const primary = await db.query.sites.findFirst({ where: eq(sites.isPrimary, true), columns: { id: true, domain: true } })
  if (!primary) return { checked: limited.length, notified: capNotified }

  const [latestDatabaseDay] = await db.select({ day: max(siteUsageDaily.day) }).from(siteUsageDaily).where(eq(siteUsageDaily.metric, 'database_bytes'))
  const [totals, databaseSizes, alreadySent] = await Promise.all([
    db.select({ siteId: siteUsageDaily.siteId, metric: siteUsageDaily.metric, value: sql<number>`sum(${siteUsageDaily.value})` })
      .from(siteUsageDaily)
      .where(gte(siteUsageDaily.day, monthStart))
      .groupBy(siteUsageDaily.siteId, siteUsageDaily.metric),
    latestDatabaseDay?.day
      ? db.select({ siteId: siteUsageDaily.siteId, value: siteUsageDaily.value }).from(siteUsageDaily)
          .where(and(eq(siteUsageDaily.metric, 'database_bytes'), eq(siteUsageDaily.day, latestDatabaseDay.day)))
      : Promise.resolve([]),
    db.select({ data: notifications.data })
      .from(notifications)
      .where(and(eq(notifications.siteId, primary.id), eq(notifications.type, 'system.plan_usage'), gte(notifications.createdAt, monthStart))),
  ])
  // A snapshot metric is a total, not a monthly sum: take the latest night's value instead.
  const used = new Map(totals.filter(t => t.metric !== 'database_bytes').map(t => [`${t.siteId}|${t.metric}`, Number(t.value)]))
  for (const d of databaseSizes) used.set(`${d.siteId}|database_bytes`, Number(d.value))
  const sent = new Set(alreadySent.map((n) => {
    const d = (n.data ?? {}) as Record<string, unknown>
    return `${d.siteId}|${d.limit}|${d.threshold}|${d.month}`
  }))

  const event = createSystemEvent({ env: globalThis.__env__, siteId: primary.id, host: primary.domain })
  let notified = capNotified
  for (const { site, plan } of limited) {
    for (const limit of ALERT_LIMITS) {
      const max = planMax(plan as HostingPlan, limit.key)
      if (!max) continue
      const value = used.get(`${site.id}|${METRIC[limit.key]}`) ?? 0
      const threshold = THRESHOLDS.find(t => value >= (max * t) / 100)
      if (!threshold) continue
      // Reaching 100% first also covers 80%: one notice, not two.
      if (sent.has(`${site.id}|${limit.key}|${threshold}|${month}`) || (threshold === 80 && sent.has(`${site.id}|${limit.key}|100|${month}`))) continue

      const pct = Math.round((value / max) * 100)
      const blocked = limit.kind === 'hard' && threshold === 100
      await notifySiteRole(event, {
        siteId: primary.id,
        minRole: 'super_admin',
        type: 'system.plan_usage',
        title: `${site.name}: ${limit.label.toLowerCase()} at ${pct}%`,
        body: (limit.monthly
          ? `${site.name} (${site.domain}) has used ${formatAmount(limit.unit, value)} of ${formatAmount(limit.unit, max)} ${limit.label.toLowerCase()} on the ${plan.name} plan this month.`
          : `${site.name} (${site.domain}) is at ${formatAmount(limit.unit, value)} of the ${formatAmount(limit.unit, max)} ${limit.label.toLowerCase()} on the ${plan.name} plan.`)
          + (blocked ? ' New requests are refused until the 1st.' : limit.kind === 'soft' ? ' Nothing is blocked — this is for you to decide.' : ''),
        data: { siteId: site.id, limit: limit.key, threshold, month },
        pushUrl: '/admin/super/usage',
        actionLabel: 'Open Usage',
        sendEmailNotification: true,
      })
      sent.add(`${site.id}|${limit.key}|${threshold}|${month}`)
      notified++
    }
  }
  return { checked: limited.length, notified }
}

/**
 * Tells the operator when customer sites together reach 80% or 100% of the platform's
 * daily AI credit cap (ai-allowance.ts) — once per threshold per UTC day.
 */
export const sendPlatformAiCapAlert = async (now = new Date()): Promise<number> => {
  const db = useDb()
  const cap = await getAiDailyCap(db)
  if (!cap) return 0
  const primary = await db.query.sites.findFirst({ where: eq(sites.isPrimary, true), columns: { id: true, domain: true } })
  if (!primary) return 0
  const day = utcDay(now)
  const used = await platformAiCreditsToday(db, primary.id, now)
  const threshold = THRESHOLDS.find(t => used >= (cap * t) / 100)
  if (!threshold) return 0

  const sentToday = await db.select({ data: notifications.data })
    .from(notifications)
    .where(and(eq(notifications.siteId, primary.id), eq(notifications.type, 'system.plan_usage'), gte(notifications.createdAt, day)))
  const sent = new Set(sentToday.map((n) => {
    const d = (n.data ?? {}) as Record<string, unknown>
    return d.limit === 'platform_ai' ? `${d.threshold}|${d.day}` : ''
  }))
  if (sent.has(`${threshold}|${day}`) || (threshold === 80 && sent.has(`100|${day}`))) return 0

  const event = createSystemEvent({ env: globalThis.__env__, siteId: primary.id, host: primary.domain })
  await notifySiteRole(event, {
    siteId: primary.id,
    minRole: 'super_admin',
    type: 'system.plan_usage',
    title: `Platform AI at ${Math.round((used / cap) * 100)}% of today's cap`,
    body: `Customer sites have used ${used.toLocaleString('en')} of the ${cap.toLocaleString('en')} AI credits allowed today.`
      + (threshold === 100 ? ' Workers AI is paused for them until midnight UTC; sites with their own AI key are unaffected.' : ''),
    data: { limit: 'platform_ai', threshold, day },
    pushUrl: '/admin/super/platform',
    actionLabel: 'Open Platform',
    sendEmailNotification: true,
  })
  return 1
}
