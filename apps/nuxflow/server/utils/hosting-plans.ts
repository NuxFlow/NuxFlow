import type { H3Event } from 'h3'
import { and, count, desc, eq, gt, gte, ne, notInArray, sql } from 'drizzle-orm'
import { contentItems, dynamicPlugins, emailMessages, hostingPlans, media, siteDomains, siteInvitations, sites, siteUsageDaily, userSiteRoles } from '@nuxflow/db/schema'
import { PLAN_LIMITS, planFeature, planLimit, type PlanFeatureKey, type PlanLimitKey } from '../../shared/lib/hosting-plan-limits'
import { useDb, type Db } from './db'
import { createIsolateCache } from './isolate-cache'
import { pendingUsage, usageDay, type UsageEventMetric } from './usage'
import { isHostingPlatform } from './hosting-platform'
import { bumpCacheVersion } from './cache-version'

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

/**
 * After sites' plans (or a plan's yes/no features) change: drop the cached plans and clear
 * those sites' edge caches, since `GET /api/public/site` bakes plan features into the
 * cached JSON (image transformations) — otherwise a site moved off a feature would keep
 * using it until its next content edit.
 */
export async function refreshSitesAfterPlanChange(event: H3Event, siteIds: string[]): Promise<void> {
  clearHostingPlanCache()
  await Promise.all(siteIds.map(id => bumpCacheVersion(event, id).catch((err) => {
    console.error(`[hosting-plans] Could not clear the cache for site ${id}:`, err)
  })))
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

/** The site_usage_daily metric each monthly limit reads. */
export const MONTHLY_METRIC: Record<'ai' | 'visitor_ai' | 'emails' | 'inbound' | 'views' | 'renders' | 'plugin_calls', UsageEventMetric> = {
  ai: 'ai_credits',
  visitor_ai: 'ai_visitor_credits',
  emails: 'emails',
  inbound: 'inbound_emails',
  views: 'views',
  renders: 'renders',
  plugin_calls: 'plugin_calls',
}

/**
 * Does the site's plan include a yes/no feature? No plan (the built-in unlimited one, or
 * the hosting-platform switch off) includes everything.
 */
export async function planIncludes(db: Db, siteId: string, key: PlanFeatureKey): Promise<boolean> {
  const plan = await getSitePlan(db, siteId)
  if (!plan) return true
  return plan[planFeature(key).column] === true
}

// Roles that are audience, not staff. super_admin is the platform operator's own grant
// and never counts against a tenant's team.
const MEMBER_ROLE = 'member' as const
const NOT_TEAM_ROLES: ('member' | 'super_admin')[] = ['member', 'super_admin']

/** How much of a limit the site is using right now. */
export async function planUsage(db: Db, siteId: string, key: PlanLimitKey, now = new Date()): Promise<number> {
  switch (key) {
    case 'storage': {
      // The media library plus inbound email (raw messages and attachments) kept in R2.
      const [[m], [e]] = await Promise.all([
        db.select({ n: sql<number>`coalesce(sum(${media.size}), 0)` }).from(media).where(eq(media.siteId, siteId)),
        db.select({ n: sql<number>`coalesce(sum(${emailMessages.storedBytes}), 0)` }).from(emailMessages).where(eq(emailMessages.siteId, siteId)),
      ])
      return Number(m?.n ?? 0) + Number(e?.n ?? 0)
    }
    case 'database': {
      // Measured nightly (usage-snapshot.ts) — too costly to add up on demand.
      const [r] = await db.select({ n: siteUsageDaily.value }).from(siteUsageDaily)
        .where(and(eq(siteUsageDaily.siteId, siteId), eq(siteUsageDaily.metric, 'database_bytes')))
        .orderBy(desc(siteUsageDaily.day))
        .limit(1)
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
    case 'domains': {
      const [r] = await db.select({ n: count() }).from(siteDomains).where(and(eq(siteDomains.siteId, siteId), eq(siteDomains.kind, 'custom')))
      return r?.n ?? 0
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
    case 'domains': return max === 0 ? "Your plan doesn't include your own domain. Ask about a bigger plan." : `Your plan allows ${max.toLocaleString('en')} of your own domains.`
    case 'plugins': return max === 0 ? "Your plan doesn't include plugins." : `Your plan allows ${max.toLocaleString('en')} plugins.`
    case 'ai': return "This month's AI allowance is used up. It resets on the 1st. To keep going now, add your own AI key in Settings → AI."
    case 'emails': return "This month's email allowance is used up. It resets on the 1st. Sign-in and security emails still go out."
    case 'visitor_ai': return "This month's AI allowance for visitor features is used up. It resets on the 1st."
    case 'inbound': return "This month's allowance for receiving email is used up. New mail is turned away until the 1st."
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
export async function assertWithinPlan(event: H3Event, key: PlanLimitKey, amount = 1, siteId = (event.context.siteId ?? undefined)): Promise<void> {
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
