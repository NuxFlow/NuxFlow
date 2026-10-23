import type { H3Event } from 'h3'
import { z } from 'zod'
import { and, eq, ne, sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import { auditLogs, hostingPlans, siteDirectory, siteDomains, sites, users } from '@nuxflow/db/schema'
import { useDb, type Db } from './db'
import { normalizeDomain } from './domain'
import { notifySiteRole } from './notify'
import { waitUntil } from './cf-env'
import { refreshSitesAfterPlanChange } from './hosting-plans'
import { clearSiteCache } from '../middleware/02.multi-site'
import { getClientIp } from './client-ip'

/**
 * Super Admin → Sites' changes to a site, applied to the database the site lives in: the
 * control plane's own (PATCH /api/v1/admin/sites/:id), or a member pool's, which the
 * control plane asks over the pool's private binding (pool-sites.ts).
 */
export const siteChangesSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  domain: z.string().optional(),
  status: z.enum(['active', 'maintenance', 'suspended']).optional(),
  locale: z.string().optional(),
  /** null = the built-in unlimited plan. */
  hostingPlanId: z.string().nullable().optional(),
})

export type SiteChanges = z.infer<typeof siteChangesSchema>

/** The acting user's id if they exist in this database (a pool may never have seen the operator), else null. */
export async function knownUserId(db: Db, userId: string | null): Promise<string | null> {
  if (!userId) return null
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1)
  return row ? row.id : null
}

/**
 * A domain this site may take: not another site's main or extra address here, and not an
 * address the router already sends to a site in a member pool (`site_directory`, empty
 * except on a control plane with pools). Returns it normalized, as the Host header will
 * present it (see utils/domain.ts).
 */
export async function assertDomainAvailable(db: Db, rawDomain: string, siteId: string | null): Promise<string> {
  const domain = normalizeDomain(rawDomain)
  if (!domain) throw validationError('Enter a valid domain, e.g. example.com')
  const problem = await domainUse(db, domain, siteId)
  if (problem) throw conflict(problem)
  return domain
}

/** Whether an (already normalized) domain is used by any site other than `siteId`, anywhere — hosting sign-ups ask this. */
export async function domainTaken(db: Db, domain: string, siteId: string | null = null): Promise<boolean> {
  return (await domainUse(db, domain, siteId)) !== null
}

async function domainUse(db: Db, domain: string, siteId: string | null): Promise<string | null> {
  const taken = await db.query.sites.findFirst({ where: eq(sites.domain, domain), columns: { id: true } })
  if (taken && taken.id !== siteId) return 'Another site already uses that domain'
  const alias = await db.query.siteDomains.findFirst({ where: eq(siteDomains.hostname, domain), columns: { siteId: true } })
  if (alias && alias.siteId !== siteId) return 'That domain is already connected to another site'
  const routed = await db.select({ poolId: siteDirectory.poolId }).from(siteDirectory)
    .where(siteId ? and(eq(siteDirectory.hostname, domain), ne(siteDirectory.poolSiteId, siteId)) : eq(siteDirectory.hostname, domain))
    .limit(1)
  if (routed.length) return 'Another site already uses that domain (in a pool)'
  return null
}

/**
 * Applies Super Admin's changes to a site in this database. False when the site isn't
 * here. `quiet` skips telling the site's admins about a status change — hosting billing
 * pausing an unpaid site already emails its owner (hosting-billing.ts).
 */
export async function updateSiteRecord(event: H3Event, siteId: string, changes: SiteChanges, actorUserId: string | null, opts: { quiet?: boolean } = {}): Promise<boolean> {
  const db = useDb(event)
  const body = { ...changes }
  const existing = await db.query.sites.findFirst({
    where: eq(sites.id, siteId),
    columns: { domain: true, status: true, name: true, locale: true, hostingPlanId: true },
  })
  if (!existing) return false

  if (body.domain !== undefined) body.domain = await assertDomainAvailable(db, body.domain, siteId)

  if (body.hostingPlanId) {
    const plan = await db.query.hostingPlans.findFirst({ where: eq(hostingPlans.id, body.hostingPlanId), columns: { id: true } })
    if (!plan) throw validationError('That hosting plan no longer exists')
  }

  await db.update(sites).set({ ...body, updatedAt: sql`(datetime('now'))` }).where(eq(sites.id, siteId))
  if (body.hostingPlanId !== undefined && body.hostingPlanId !== existing.hostingPlanId) await refreshSitesAfterPlanChange(event, [siteId])

  // writeAuditLog() always scopes the row to event.context.siteId (the acting
  // super admin's CURRENT site from the Host header), which would be the wrong
  // site here — the action targets the site being patched, not the caller's
  // own. Insert directly, scoped to the target site's real id, mirroring the
  // explicit-siteId pattern deleteSiteCompletely() uses for the same reason.
  await db.insert(auditLogs).values({
    id: ulid(),
    siteId,
    userId: await knownUserId(db, actorUserId),
    action: 'update',
    resource: 'site',
    resourceId: siteId,
    before: existing,
    after: body,
    ipAddress: getClientIp(event) ?? null,
    userAgent: getHeader(event, 'user-agent') ?? null,
  })

  // Domain (or status) may have changed — drop the whole cache rather than
  // tracking the old domain key, since a rename means the old key is now stale too.
  clearSiteCache()

  if (body.status && body.status !== existing.status && !opts.quiet) {
    const described = { active: 'reactivated', maintenance: 'put into maintenance mode', suspended: 'suspended by the platform operator' }[body.status]
    waitUntil(event, notifySiteRole(event, {
      siteId,
      minRole: 'admin',
      excludeUserId: actorUserId ?? undefined,
      type: 'system.site_status',
      title: `${existing.name} was ${described}`,
      body: body.status === 'suspended'
        ? `${existing.name} (${existing.domain}) is now suspended: visitors and the admin panel are closed. Contact the platform operator for details.`
        : `${existing.name} (${existing.domain}) was ${described}.`,
      sendEmailNotification: true,
      sendPush: true,
    }).catch(err => console.error('[sites] Status notification failed:', err)))
  }
  return true
}
