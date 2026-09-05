import { z } from 'zod'
import { useDb } from '../../../../utils/db'
import { requireSuperAdmin } from '../../../../utils/permissions'
import { clearSiteCache } from '../../../../middleware/02.multi-site'
import { created } from '../../../../utils/response'
import { sites, auditLogs } from '@nuxflow/db/schema'
import { ulid } from 'ulid'

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  domain: z.string().min(1),
  locale: z.string().default('en'),
  timezone: z.string().default('UTC'),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireSuperAdmin(event)
  const db = useDb(event)
  const body = await parseBody(event, bodySchema)

  const id = ulid()

  // One-time token required to complete /setup for this site — only the hash is persisted,
  // so this is the only chance to hand the raw token to the caller.
  const rawBytes = crypto.getRandomValues(new Uint8Array(32))
  const setupToken = btoa(String.fromCharCode(...rawBytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  const setupTokenHash = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(setupToken)))
  ).map(b => b.toString(16).padStart(2, '0')).join('')

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
    ipAddress: getHeader(event, 'cf-connecting-ip') ?? getHeader(event, 'x-forwarded-for') ?? null,
    userAgent: getHeader(event, 'user-agent') ?? null,
  })

  // A request for this domain made just before creation would have cached a
  // "no site" miss — clear it so the new site is picked up immediately.
  clearSiteCache(body.domain)
  return created(event, { id, setupToken })
})
