import { and, eq, gte, isNotNull, sql } from 'drizzle-orm'
import { hostingPlans, notifications, sites, siteUsageDaily } from '@nuxflow/db/schema'
import { useDb } from '../utils/db'
import { createSystemEvent } from '../utils/system-event'
import { notifySiteRole } from '../utils/notify'
import { planMax, type HostingPlan } from '../utils/hosting-plans'
import { usageDay } from '../utils/usage'
import { PLAN_LIMITS } from '../../shared/lib/hosting-plan-limits'

const THRESHOLDS = [100, 80] as const
const MONTHLY_LIMITS = PLAN_LIMITS.filter(l => l.monthly)
const METRIC: Record<string, string> = { ai: 'ai_calls', emails: 'emails', views: 'views', renders: 'renders' }

/**
 * Hourly: tells the platform operator (super admins of the primary site) when a site
 * reaches 80% or 100% of a monthly limit on its hosting plan — once per site, limit,
 * threshold and month. For soft limits (views, renders) this is the only thing that
 * happens: a person decides what to do. Uses the notifications table itself as the
 * "already told" record, like stale-content-scan.ts.
 */
export const sendPlanUsageAlerts = async (now = new Date()) => {
  const db = useDb()
  const month = usageDay(now).slice(0, 7)
  const monthStart = `${month}-01`

  const limited = await db.select({ site: { id: sites.id, name: sites.name, domain: sites.domain }, plan: hostingPlans })
    .from(sites)
    .innerJoin(hostingPlans, eq(hostingPlans.id, sites.hostingPlanId))
    .where(isNotNull(sites.hostingPlanId))
  if (!limited.length) return { checked: 0, notified: 0 }

  const primary = await db.query.sites.findFirst({ where: eq(sites.isPrimary, true), columns: { id: true, domain: true } })
  if (!primary) return { checked: limited.length, notified: 0 }

  const [totals, alreadySent] = await Promise.all([
    db.select({ siteId: siteUsageDaily.siteId, metric: siteUsageDaily.metric, value: sql<number>`sum(${siteUsageDaily.value})` })
      .from(siteUsageDaily)
      .where(gte(siteUsageDaily.day, monthStart))
      .groupBy(siteUsageDaily.siteId, siteUsageDaily.metric),
    db.select({ data: notifications.data })
      .from(notifications)
      .where(and(eq(notifications.siteId, primary.id), eq(notifications.type, 'system.plan_usage'), gte(notifications.createdAt, monthStart))),
  ])
  const used = new Map(totals.map(t => [`${t.siteId}|${t.metric}`, Number(t.value)]))
  const sent = new Set(alreadySent.map((n) => {
    const d = (n.data ?? {}) as Record<string, unknown>
    return `${d.siteId}|${d.limit}|${d.threshold}|${d.month}`
  }))

  const event = createSystemEvent({ env: (globalThis as { __env__?: unknown }).__env__, siteId: primary.id, host: primary.domain })
  let notified = 0
  for (const { site, plan } of limited) {
    for (const limit of MONTHLY_LIMITS) {
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
        body: `${site.name} (${site.domain}) has used ${value.toLocaleString('en')} of ${max.toLocaleString('en')} ${limit.label.toLowerCase()} on the ${plan.name} plan this month.`
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
