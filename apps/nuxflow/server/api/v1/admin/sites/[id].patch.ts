import { z } from 'zod'
import { useDb } from '../../../../utils/db'
import { requireSuperAdmin } from '../../../../utils/permissions'
import { clearSiteCache } from '../../../../middleware/02.multi-site'
import { sites, auditLogs } from '@nuxflow/db/schema'
import { eq, sql } from 'drizzle-orm'
import { ulid } from 'ulid'

const bodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  domain: z.string().optional(),
  status: z.enum(['active', 'maintenance', 'suspended']).optional(),
  locale: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireSuperAdmin(event)
  const db = useDb(event)
  const id = getRouterParam(event, 'id')!
  const body = await parseBody(event, bodySchema)

  const existing = await db.query.sites.findFirst({
    where: eq(sites.id, id),
    columns: { domain: true, status: true, name: true, locale: true },
  })
  if (!existing) throw notFound('Site not found')

  await db.update(sites).set({ ...body, updatedAt: sql`(datetime('now'))` }).where(eq(sites.id, id))

  // writeAuditLog() always scopes the row to event.context.siteId (the acting
  // super admin's CURRENT site from the Host header), which would be the wrong
  // site here — the action targets the site being patched, not the caller's
  // own. Insert directly, scoped to the target site's real id, mirroring the
  // explicit-siteId pattern deleteSiteCompletely() uses for the same reason.
  await db.insert(auditLogs).values({
    id: ulid(),
    siteId: id,
    userId,
    action: 'update',
    resource: 'site',
    resourceId: id,
    before: existing,
    after: body,
    ipAddress: getHeader(event, 'cf-connecting-ip') ?? getHeader(event, 'x-forwarded-for') ?? null,
    userAgent: getHeader(event, 'user-agent') ?? null,
  })

  // Domain (or status) may have changed — drop the whole cache rather than
  // tracking the old domain key, since a rename means the old key is now stale too.
  clearSiteCache()
  return { id }
})
