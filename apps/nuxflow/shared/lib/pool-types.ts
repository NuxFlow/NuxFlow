// Member pools (server/utils/pools.ts, pool-admin.ts, site-directory.ts): what a pool
// reports to its control plane over the NuxflowPoolAdmin binding, and what Super Admin →
// Pools shows. Fields added to what a pool sends must stay optional for a release (pools
// and the control plane run different releases for days: POOL_PROTOCOL). Import-free.

export interface PoolStatus {
  protocol: number
  poolId: string | null
  commit: string | null
  release: string | null
  siteCount: number
  /** Newest migration file applied to this pool's D1. */
  lastMigration: string | null
  /** When the control plane last sent platform settings (null = never). */
  settingsReceivedAt: string | null
}

export interface PoolSite {
  id: string
  name: string
  domain: string
  status: string
  createdAt: string
  /**
   * The site's extra addresses (site_domains), which redirect to `domain`. Optional:
   * a pool on an older release doesn't send it.
   */
  aliases?: string[]
  /** Optional, like aliases: older pools don't send them. */
  hostingPlanId?: string | null
  locale?: string
  /** Locked while being moved to another pool. Optional, like the fields above. */
  moving?: boolean
}

/** One pool as Super Admin → Pools shows it. */
export interface PoolReport {
  binding: string
  /** null when the pool couldn't be reached. */
  status: PoolStatus | null
  sites: PoolSite[]
  error: string | null
}

/** This Worker, the control plane. */
export interface ControlPlaneSummary {
  commit: string | null
  release: string | null
  siteCount: number
  /** Sites besides the operator's own still on this Worker. */
  customerSites: number
  /** Plans whose sign-ups land here rather than in a pool. */
  plansWithoutPool: number
}

/** GET /api/v1/admin/pools. */
export interface PoolsOverview {
  controlPlane: ControlPlaneSummary
  pools: PoolReport[]
  /** The newest release anything here runs, so the page can show who hasn't got it yet. */
  newestRelease: string | null
  /** Addresses the front-door router sends to each pool, by pool id. */
  routed: Record<string, number>
}

/** POST /api/v1/admin/pools/settings: one pool's answer. */
export interface PoolPushResult {
  binding: string
  ok: boolean
  error: string | null
}

export interface DirectoryConflict {
  hostname: string
  reason: string
}

/** POST /api/v1/admin/pools/directory (and the hourly sync). */
export interface DirectorySyncResult {
  /** Addresses now routed to a pool. */
  routed: number
  added: string[]
  removed: string[]
  /** Addresses left out: they'd send a site's visitors to the wrong place. */
  conflicts: DirectoryConflict[]
  /** Pools that didn't answer — their existing entries were kept. */
  unreachable: string[]
}
