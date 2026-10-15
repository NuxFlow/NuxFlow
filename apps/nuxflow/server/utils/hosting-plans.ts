import type { H3Event } from 'h3'
import { and, count, eq, gt, gte, ne, notInArray, sql } from 'drizzle-orm'
import { contentItems, dynamicPlugins, hostingPlans, media, siteInvitations, sites, siteUsageDaily, userSiteRoles } from '@nuxflow/db/schema'
import { PLAN_LIMITS, planLimit, type PlanLimitKey } from '../../shared/lib/hosting-plan-limits'
import { useDb, type Db } from './db'
import { createIsolateCache } from './isolate-cache'
import { pendingUsage, usageDay, type UsageEventMetric } from './usage'
import { isHostingPlatform } from './hosting-platform'

/**
 * Hosting plans: what the operator sells a site, and the limits that come with it
 * (shared/lib/hosting-plan-limits.ts lists them). A site with no plan is on the built-in
 * unlimited plan, and so is every site while the hosting-platform switch is off
 * (hosting-platform.ts), so single-site installs never meet any of this.
 *
 * `assertWithinPlan()` is called right before an action that adds to a hard limit and
 * throws a 403 with `data.code = 'plan_limit'` when the action would go over. Counts that
 * are totals (storage, content, people, plugins) are read live; monthly ones (AI calls,
 * emails, views, renders) come from site_usage_daily plus this isolate's unwritten counts,
 * so a burst across many isolates can overshoot by about a minute's worth — fine for an
 * allowance, and never the other way round.
 */

export type HostingPlan = typeof hostingPlans.$inferSelect

// Looked up once a minute per isolate, not on every request (design: plan 08 §7).
const planCache = createIsolateCache<HostingPlan | null>(60_000)

export function clearHostingPlanCache(): void {
  planCache.clear()
}

/** The site's plan, or null for the built-in unlimited plan (always, while the hosting-platform switch is off). */
export async function getSitePlan(db: Db, siteId: string): Promise<HostingPlan | null> {
  if (!(await isHostingPlatform(db))) return null
  const cached = planCache.get(siteId)
  if (cached !== undefined) return cached
  const [row] = await db.select({ plan: hostingPlans })
    .from(sites)
    .innerJoin(hostingPlans, eq(hostingPlans.id, sites.hostingPlanId))
    .where(eq(sites.id, siteId))
    .limit(1)
  const plan = row?.plan ?? null
  planCache.set(siteId, plan)
  return plan
}

export function planMax(plan: HostingPlan | null, key: PlanLimitKey): number | null {
  if (!plan) return null
  const value = plan[planLimit(key).column]
  return value ?? null
}

const MONTHLY_METRIC: Record<'ai' | 'emails' | 'views' | 'renders', UsageEventMetric> = {
  ai: 'ai_calls',
  emails: 'emails',
  views: 'views',
  renders: 'renders',
}

// Roles that are audience, not staff. super_admin is the platform operator's own grant
// and never counts against a tenant's team.
const MEMBER_ROLE = 'member' as const
const NOT_TEAM_ROLES: ('member' | 'super_admin')[] = ['member', 'super_admin']

/** How much of a limit the site is using right now. */
export async function planUsage(db: Db, siteId: string, key: PlanLimitKey, now = new Date()): Promise<number> {
  switch (key) {
    case 'storage': {
      const [r] = await db.select({ n: sql<number>`coalesce(sum(${media.size}), 0)` }).from(media).where(eq(media.siteId, siteId))
      return Number(r?.n ?? 0)
    }
    case 'content': {
      const [r] = await db.select({ n: count() }).from(contentItems).where(eq(contentItems.siteId, siteId))
      return r?.n ?? 0
    }
    case 'team':
    case 'members': {
      const roleFilter = key === 'team' ? notInArray(userSiteRoles.role, NOT_TEAM_ROLES) : eq(userSiteRoles.role, MEMBER_ROLE)
      const inviteFilter = key === 'team' ? ne(siteInvitations.role, MEMBER_ROLE) : eq(siteInvitations.role, MEMBER_ROLE)
      const [[roles], [invites]] = await Promise.all([
        db.select({ n: count() }).from(userSiteRoles).where(and(eq(userSiteRoles.siteId, siteId), roleFilter)),
        db.select({ n: count() }).from(siteInvitations)
          .where(and(eq(siteInvitations.siteId, siteId), inviteFilter, gt(siteInvitations.expiresAt, now.toISOString()))),
      ])
      return (roles?.n ?? 0) + (invites?.n ?? 0)
    }
    case 'plugins': {
      const [r] = await db.select({ n: count() }).from(dynamicPlugins).where(eq(dynamicPlugins.siteId, siteId))
      return r?.n ?? 0
    }
    default:
      return monthlyUsage(db, siteId, MONTHLY_METRIC[key], now)
  }
}

/** A monthly event metric so far this calendar month (UTC): stored rows plus this isolate's unwritten counts. */
export async function monthlyUsage(db: Db, siteId: string, metric: UsageEventMetric, now = new Date()): Promise<number> {
  const monthStart = `${usageDay(now).slice(0, 7)}-01`
  const [r] = await db.select({ n: sql<number>`coalesce(sum(${siteUsageDaily.value}), 0)` })
    .from(siteUsageDaily)
    .where(and(eq(siteUsageDaily.siteId, siteId), eq(siteUsageDaily.metric, metric), gte(siteUsageDaily.day, monthStart)))
  const unwritten = pendingUsage()
    .filter(p => p.siteId === siteId && p.metric === metric && p.day >= monthStart)
    .reduce((sum, p) => sum + p.value, 0)
  return Number(r?.n ?? 0) + unwritten
}

/** Which people limit a role counts against: members are audience, every other role is team. */
export function limitForRole(role: string): 'team' | 'members' {
  return role === MEMBER_ROLE ? 'members' : 'team'
}

export interface PlanCheck {
  key: PlanLimitKey
  allowed: boolean
  used: number
  max: number | null
}

/** Would adding `amount` stay within the site's plan? Unlimited answers without a query. */
export async function checkPlanLimit(db: Db, siteId: string, key: PlanLimitKey, amount = 1): Promise<PlanCheck> {
  const max = planMax(await getSitePlan(db, siteId), key)
  if (max === null) return { key, allowed: true, used: 0, max: null }
  const used = await planUsage(db, siteId, key)
  return { key, allowed: used + amount <= max, used, max }
}

export function planLimitMessage(key: PlanLimitKey, max: number): string {
  switch (key) {
    case 'storage': return `Your plan's storage is full (${formatPlanBytes(max)}). Delete some media, or ask about a bigger plan.`
    case 'content': return `Your plan allows ${max.toLocaleString('en')} pages and posts.`
    case 'team': return `Your plan allows ${max.toLocaleString('en')} team members.`
    case 'members': return "This site isn't accepting new members."
    case 'plugins': return max === 0 ? "Your plan doesn't include plugins." : `Your plan allows ${max.toLocaleString('en')} plugins.`
    case 'ai': return "This month's AI allowance is used up. It resets on the 1st."
    case 'emails': return "This month's email allowance is used up. It resets on the 1st. Sign-in and security emails still go out."
    default: return 'This is over your plan.'
  }
}

export class PlanLimitError extends Error {
  constructor(readonly check: PlanCheck) {
    super(planLimitMessage(check.key, check.max ?? 0))
    this.name = 'PlanLimitError'
  }
}

/**
 * Throws a 403 (`data.code: 'plan_limit'`) when adding `amount` would take the site over a
 * hard limit. `amount` is bytes for storage, otherwise a count.
 */
export async function assertWithinPlan(event: H3Event, key: PlanLimitKey, amount = 1, siteId = event.context.siteId as string | undefined): Promise<void> {
  if (!siteId) return
  if (planLimit(key).kind !== 'hard') return
  const check = await checkPlanLimit(useDb(event), siteId, key, amount)
  if (check.allowed) return
  throw createError({
    statusCode: 403,
    message: planLimitMessage(key, check.max ?? 0),
    data: { code: 'plan_limit', limit: key, used: check.used, max: check.max },
  })
}

/** Every limit on the site's plan with current usage — for the site owner's usage card. */
export async function sitePlanSummary(db: Db, siteId: string) {
  const plan = await getSitePlan(db, siteId)
  if (!plan) return { plan: null, limits: [] }
  const limited = PLAN_LIMITS.filter(l => planMax(plan, l.key) !== null)
  const used = await Promise.all(limited.map(l => planUsage(db, siteId, l.key)))
  return {
    plan: { id: plan.id, name: plan.name, description: plan.description },
    limits: limited.map((l, i) => ({ key: l.key, label: l.label, kind: l.kind, monthly: l.monthly, unit: l.unit, used: used[i]!, max: planMax(plan, l.key)! })),
  }
}

function formatPlanBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ${units[unit]}`
}
