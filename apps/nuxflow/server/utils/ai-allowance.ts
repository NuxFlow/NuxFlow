import type { H3Event } from 'h3'
import { and, gte, inArray, ne, sql } from 'drizzle-orm'
import { siteUsageDaily } from '@nuxflow/db/schema'
import { useDb, type Db } from './db'
import { createIsolateCache } from './isolate-cache'
import { isHostingPlatform } from './hosting-platform'
import { checkPlanLimit, planLimitMessage, type PlanCheck } from './hosting-plans'
import { countUsage, pendingUsage, usageDay } from './usage'
import { getPrimarySite } from './site-info'
import { getPlatformSetting } from './control-plane'

/**
 * AI the platform pays for, and how much of it a site may use.
 *
 * Two kinds of AI call exist on a hosting platform:
 * - **Platform-paid** — the Workers AI binding (billed to the operator's Cloudflare account)
 *   or, on the primary site only, an AI key from the deployment's env vars. These are
 *   counted as **AI credits** (`ai_credits` in site_usage_daily) and limited by the site's
 *   hosting plan ("AI credits a month") and by the platform-wide daily cap below.
 * - **Site-paid** — the site's own API key from Settings → AI. It costs the operator
 *   nothing, so it's never counted against the plan or the cap, and never refused by them.
 *
 * Every call of either kind still counts once in `ai_calls`, for Super Admin → Usage.
 *
 * Platform-paid calls are split by who set them off. The site's team (writing tools, page
 * generation) uses `ai_credits` and the plan's "AI credits a month". Visitors, incoming
 * mail and plugins (Listen to this article, spam checks on comments and forms, inbox
 * sorting, smart search, plugin AI — plugin routes are public) use `ai_visitor_credits` and the plan's "Visitor AI credits a month" — so
 * a bot hammering a public feature can only pause those features, never the team's tools.
 * Both count towards the platform-wide daily cap.
 *
 * Credits are weighted so the allowance follows the real bill rather than the number of
 * clicks: a page generation on the big model costs far more than a grammar check. The
 * weights are relative, not a price — see AI_CREDITS.
 */

export type AiPayer = 'platform' | 'site'

/** Who set the call off: the site's own team, or the public (visitors, incoming mail). */
export type AiTrigger = 'team' | 'visitor'

const CREDIT_METRIC = { team: 'ai_credits', visitor: 'ai_visitor_credits' } as const
const PLAN_KEY = { team: 'ai', visitor: 'visitor_ai' } as const
const PLATFORM_CREDIT_METRICS = [CREDIT_METRIC.team, CREDIT_METRIC.visitor]

/**
 * Credit weights. 1 credit ≈ 1,000 tokens (prompt + answer) on the fast text model. The
 * heavy model (Workers AI 'smart'/'vision' — kimi-k2.7-code) costs roughly 5× the fast one
 * per token on Cloudflare's price list, so its tokens count 5×. Image generation,
 * transcription and speech have no tokens, so each is a flat or per-character amount
 * pitched at a similar cost. Every call is at least 1 credit.
 */
export const AI_CREDITS = {
  tokensPerCredit: 1000,
  heavyModelMultiplier: 5,
  image: 10,
  transcription: 2,
  speechCharsPerCredit: 1000,
  /** One embedding (semantic search index or query) — tiny next to a generation. */
  embedding: 1,
} as const

export function textCredits(totalTokens: number | undefined, heavy: boolean): number {
  const tokens = Number.isFinite(totalTokens) && totalTokens! > 0 ? totalTokens! : 0
  const weighted = (tokens / AI_CREDITS.tokensPerCredit) * (heavy ? AI_CREDITS.heavyModelMultiplier : 1)
  return Math.max(1, Math.ceil(weighted))
}

export function speechCredits(chars: number): number {
  return Math.max(1, Math.ceil(chars / AI_CREDITS.speechCharsPerCredit))
}

// ── Platform-wide daily cap ────────────────────────────────────────────────────────────

/**
 * Most AI credits all hosted sites together may use in one UTC day — a safety brake so a
 * plan left without an AI limit (or a site with no plan) can't run up the operator's
 * Workers AI bill overnight. Stored on the primary site, server-managed (only
 * `PUT /api/v1/admin/platform` writes it). Unset = no cap. The primary site itself is
 * never braked: it's the operator's own.
 */
export const AI_DAILY_CAP_SETTING_KEY = 'platform.ai_daily_credit_cap'

const capCache = createIsolateCache<number | null>(60_000)

export function clearAiDailyCapCache(): void {
  capCache.clear()
}

export async function getAiDailyCap(db: Db): Promise<number | null> {
  const cached = capCache.get('cap')
  if (cached !== undefined) return cached
  // The primary site's setting, or the copy a member pool was sent (control-plane.ts).
  const value = await getPlatformSetting(db, AI_DAILY_CAP_SETTING_KEY)
  const n = Number(value)
  const cap = value != null && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
  capCache.set('cap', cap)
  return cap
}

/** AI credits (team and visitor) every site except the primary one has used today (UTC): stored rows plus this isolate's unwritten counts. */
export async function platformAiCreditsToday(db: Db, primarySiteId: string | null, now = new Date()): Promise<number> {
  const day = usageDay(now)
  const conditions = [inArray(siteUsageDaily.metric, PLATFORM_CREDIT_METRICS), gte(siteUsageDaily.day, day)]
  if (primarySiteId) conditions.push(ne(siteUsageDaily.siteId, primarySiteId))
  const [r] = await db.select({ n: sql<number>`coalesce(sum(${siteUsageDaily.value}), 0)` })
    .from(siteUsageDaily)
    .where(and(...conditions))
  const unwritten = pendingUsage()
    .filter(p => (PLATFORM_CREDIT_METRICS as string[]).includes(p.metric) && p.day >= day && p.siteId !== primarySiteId)
    .reduce((sum, p) => sum + p.value, 0)
  return Number(r?.n ?? 0) + unwritten
}

// ── Allowance checks ───────────────────────────────────────────────────────────────────

export type AiAllowanceCheck =
  | { allowed: true }
  | { allowed: false, reason: 'plan', plan: PlanCheck }
  | { allowed: false, reason: 'platform', used: number, max: number }

export const PLATFORM_AI_CAP_MESSAGE = 'AI is paused for today: the platform\'s daily AI allowance has been reached. It resets at midnight UTC. To keep going now, add your own AI key in Settings → AI.'

export function aiAllowanceMessage(check: Exclude<AiAllowanceCheck, { allowed: true }>): string {
  if (check.reason === 'platform') return PLATFORM_AI_CAP_MESSAGE
  return planLimitMessage(check.plan.key, check.plan.max ?? 0)
}

/**
 * Can this site make a platform-paid AI call costing `credits`? Only the plan and the
 * daily cap are checked — site-paid calls never come here. Usage is only known after a
 * text call, so text calls check with 1 credit; a site can go over by one call's worth.
 */
export async function checkAiAllowance(event: H3Event, credits = 1, trigger: AiTrigger = 'team', siteId = event.context?.siteId as string | undefined): Promise<AiAllowanceCheck> {
  if (!siteId) return { allowed: true }
  const db = useDb(event)
  const plan = await checkPlanLimit(db, siteId, PLAN_KEY[trigger], credits)
  if (!plan.allowed) return { allowed: false, reason: 'plan', plan }

  if (!(await isHostingPlatform(db))) return { allowed: true }
  const max = await getAiDailyCap(db)
  if (max === null) return { allowed: true }
  const primary = await getPrimarySite(event)
  if (primary?.id === siteId) return { allowed: true }
  const used = await platformAiCreditsToday(db, primary?.id ?? null)
  if (used + credits > max) return { allowed: false, reason: 'platform', used, max }
  return { allowed: true }
}

/** Thrown from inside a model call (background AI treats any throw as "skip"). */
export class AiAllowanceError extends Error {
  constructor(readonly check: Exclude<AiAllowanceCheck, { allowed: true }>) {
    super(aiAllowanceMessage(check))
    this.name = 'AiAllowanceError'
  }
}

/** Throws the standard 403 (`data.code: 'plan_limit'`, or `'platform_ai_cap'`) when a platform-paid call isn't allowed. */
export async function assertAiAllowance(event: H3Event, credits = 1, trigger: AiTrigger = 'team'): Promise<void> {
  const check = await checkAiAllowance(event, credits, trigger)
  if (check.allowed) return
  throw createError({
    statusCode: 403,
    message: aiAllowanceMessage(check),
    data: check.reason === 'plan'
      ? { code: 'plan_limit', limit: check.plan.key, used: check.plan.used, max: check.plan.max }
      : { code: 'platform_ai_cap', used: check.used, max: check.max },
  })
}

/**
 * Counts one AI call. `ai_calls` always goes up by one; the credits only for platform-paid
 * calls, into the team or visitor bucket. Never throws, like countUsage().
 */
export function recordAiCall(event: H3Event, payer: AiPayer, credits: number, trigger: AiTrigger = 'team'): void {
  countUsage(event, 'ai_calls')
  if (payer === 'platform') countUsage(event, CREDIT_METRIC[trigger], credits)
}
