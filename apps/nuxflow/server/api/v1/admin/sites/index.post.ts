import { z } from 'zod'
import { sha256Hex } from '../../../../utils/buffer'
import { useDb } from '../../../../utils/db'
import { requireSuperAdmin } from '../../../../utils/permissions'
import { requireControlPlane } from '../../../../utils/control-plane'
import { clearSiteCache } from '../../../../utils/site-resolution'
import { assertDomainAvailable } from '../../../../utils/site-admin'
import { createSiteInPool } from '../../../../utils/pool-sites'
import { isCentralAuth } from '../../../../utils/accounts-origin'
import { created } from '../../../../utils/response'
import { sites, auditLogs } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { randomToken } from '../../../../../shared/lib/base64'
import { getClientIp } from '../../../../utils/client-ip'
import { siteLocaleSchema, siteTimezoneSchema } from '../../../../utils/site-fields'

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  domain: z.string().min(1),
  locale: siteLocaleSchema.default('en'),
  timezone: siteTimezoneSchema.default('UTC'),
  // A member pool to create it in (utils/pool-sites.ts), with its owner — instead of the
  // setup link, which can't work there (a pool has no passwords to set up).
  poolId: z.string().min(1).max(40).optional(),
  owner: z.object({ name: z.string().min(1).max(100), email: z.email() }).optional(),
})

export default defineEventHandler(async (event) => {
  requireControlPlane(event)
  const { userId } = await requireSuperAdmin(event)
  // A second site means a second admin team who can add their own scripts to their own
  // pages — sign-in must move off site domains first (see utils/accounts-origin.ts).
  if (!isCentralAuth()) {
    throw conflict('Set up the central sign-in domain (NUXT_PUBLIC_ACCOUNTS_URL) before adding more sites — see "Hosting several sites" in docs/installation.md.')
  }
  const db = useDb(event)
  const { poolId, owner, ...body } = await parseBody(event, bodySchema)

  if (poolId) {
    if (!owner) throw validationError('A site in a pool needs an owner: their name and email address.')
    const { id, domain, pending, emailDelivery } = await createSiteInPool(event, { poolId, name: body.name, domain: body.domain, locale: body.locale, timezone: body.timezone, owner }, userId)
    return created(event, { id, domain, poolId, pending, emailDelivery })
  }

  // Stored exactly as the Host header will present it (see utils/domain.ts). Not one any
  // site here — or, on a platform with pools, in a pool — already uses.
  body.domain = await assertDomainAvailable(db, body.domain, null)

  const id = ulid()

  // One-time token required to complete /setup for this site — only the hash is persisted,
  // so this is the only chance to hand the raw token to the caller.
  const setupToken = randomToken()
  const setupTokenHash = await sha256Hex(setupToken)

  await db.insert(sites).values({ id, ...body, setupCompleted: false, setupTokenHash })

  // writeAuditLog() always scopes the row to event.context.siteId (the acting
  // super admin's CURRENT site from the Host header), which would be the wrong
  // site here — the action targets the newly-created site, not the caller's
  // own. Insert directly, scoped to the new site's real id, mirroring the
  // explicit-siteId pattern deleteSiteCompletely() uses for the same reason.
  await db.insert(auditLogs).values({
    id: ulid(),
    siteId: id,
    userId,
    action: 'create',
    resource: 'site',
    resourceId: id,
    after: { domain: body.domain, name: body.name },
    ipAddress: getClientIp(event) ?? null,
    userAgent: getHeader(event, 'user-agent') ?? null,
  })

  // A request for this domain made just before creation would have cached a
  // "no site" miss — clear it so the new site is picked up immediately.
  clearSiteCache(body.domain)
  // The setup link is built from the stored form, not what was typed ("https://…").
  return created(event, { id, domain: body.domain, setupToken })
})
