// Super Admin → Sites: what GET /api/v1/admin/sites sends (server/api/v1/admin/sites/
// index.get.ts, built by listAllSites() in server/utils/pool-sites.ts). Import-free.

/** A site in the list: this Worker's own, or a member pool's. */
export interface SiteListing {
  id: string
  name: string
  domain: string
  status: string
  locale?: string
  hostingPlanId: string | null
  createdAt: string
  /** The member pool it lives in, or null for this control plane's own sites. */
  poolId: string | null
  /** The operator's own site. Always one of the control plane's; it can't be deleted while others exist. */
  isPrimary: boolean
  /** Locked while being moved to another pool (site-move-job.ts). */
  moving?: boolean
}

export interface AdminSitesResponse {
  sites: SiteListing[]
  /** Pool bindings that didn't answer, so their sites are missing from `sites`. */
  unreachablePools: string[]
  /** The pools a new site can be created in. */
  pools: string[]
}
