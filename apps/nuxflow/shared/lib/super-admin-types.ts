// What the Super Admin pages get from the server: site moves, hosting plans, database size,
// email and usage. (Pools are in pool-types.ts.) Import-free apart from other shared/lib types.
import type { PlanFeatureColumn, PlanLimitColumn } from './hosting-plan-limits'
import type { UsageMetric } from './usage-metrics'

// ── Site moves (server/utils/site-move-job.ts)

/** A move between pools (the parts of the `site_moves` row the page reads). */
export interface SiteMoveSummary {
  id: string
  movedSiteId: string
  siteName: string
  siteDomain: string
  /** Null = this control plane. */
  fromPool: string | null
  toPool: string | null
  /** locking, copying, checking, switching, cleaning, done, failed or cancelled. */
  phase: string
  error: string | null
}

/** POST /api/v1/admin/site-moves/:id/step: what one step did. */
export interface SiteMoveStep {
  move: SiteMoveSummary
  /** Another step is needed — at once, or after `waitMs`. */
  more: boolean
  waitMs?: number
  /** What the step did, for the progress line. */
  message: string
}

// ── Hosting plans (GET /api/v1/admin/plans)

/** A plan with every limit (`max_*`, null = unlimited) and feature switch (`allow_*`). */
export type AdminHostingPlan = {
  id: string
  name: string
  description: string
  priceText: string
  sortOrder: number
  /** Sites on this plan. */
  siteCount: number
  isPublic: boolean
  priceMonthly: number | null
  priceYearly: number | null
  currency: string
  trialDays: number
  /** Where sign-ups on this plan get their site. */
  defaultPoolId: string | null
  stripePriceMonthlyId: string | null
  stripePriceYearlyId: string | null
} & Record<PlanLimitColumn, number | null> & Record<PlanFeatureColumn, boolean>

// ── Database size (GET /api/v1/admin/db-stats, server/utils/d1-stats.ts)

export interface SiteSizeStats {
  siteId: string
  siteName: string
  siteDomain: string
  contentItemCount: number
  contentBytes: number
  revisionCount: number
  revisionBytes: number
  mediaCount: number
  mediaBytes: number
  /** Media-library rows whose file is stored in D1 (the storage fallback), not in real storage. */
  localFallbackMediaCount: number
  /**
   * The provider new uploads go to for this site right now ('local' = no storage
   * connected). Lets the UI tell "nothing connected" apart from "connected, but older
   * files are still in the database and can be moved".
   */
  storageProvider: string
  approxTotalBytes: number
}

export interface D1SizeStats {
  /** Sum of every site's approxTotalBytes: an estimate, not an on-disk measurement. */
  approxDatabaseSizeBytes: number
  sites: SiteSizeStats[]
}

export interface DatabaseStatsResponse extends D1SizeStats {
  /** D1's size cap on the Workers Paid plan. */
  paidPlanSizeCapBytes: number
}

// ── Email (GET /api/v1/admin/email-usage)

/** One site's sending over the last 30 days. Null site = mail sent with no site (accounts). */
export interface SiteEmailUsage {
  siteId: string | null
  siteName: string | null
  domain: string | null
  sent30d: number
  failed30d: number
  sent24h: number
  /** Sent through the Cloudflare binding (the account-wide quota). */
  cloudflare30d: number
}

export interface EmailFailure {
  id: string
  siteName: string | null
  toAddress: string
  subject: string
  category: string
  provider: string
  error: string | null
  createdAt: string
}

export interface EmailUsageReport {
  sites: SiteEmailUsage[]
  recentFailures: EmailFailure[]
  sendingBindingPresent: boolean
  inboundEmailDomain: string | null
}

// ── Usage (server/utils/usage-report.ts)

/** One site's usage for a month: event metrics summed, snapshot metrics as of the month's end. */
export interface SiteMonthlyUsage {
  id: string
  name: string
  domain: string
  status: string
  isPrimary: boolean
  usage: Record<UsageMetric, number>
  /** The nightly snapshot the totals come from. */
  snapshotDay: string | null
  /** The member pool it lives in, or null for this Worker's own sites. */
  poolId: string | null
}

/** GET /api/v1/admin/usage. */
export interface UsageReport {
  month: string
  from: string
  to: string
  sites: SiteMonthlyUsage[]
  /** Pools that couldn't be reached, so their sites are missing. */
  unreachablePools: string[]
}

/** GET /api/v1/admin/usage/:siteId: per day, oldest first. A snapshot metric's day with no
 * snapshot is null (not measured, rather than empty). */
export interface SiteUsageSeries {
  site: { id: string; name: string; domain: string }
  days: string[]
  series: Record<UsageMetric, (number | null)[]>
}
