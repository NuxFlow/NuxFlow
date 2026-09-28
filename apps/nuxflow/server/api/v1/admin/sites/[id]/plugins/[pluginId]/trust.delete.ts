import { useDb } from '../../../../../../../utils/db'
import { requireSuperAdmin } from '../../../../../../../utils/permissions'
import { dynamicPluginTrust, sites, auditLogs } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'

// Platform-side counterpart to DELETE /api/v1/dynamic-plugins/:id/trust. That route acts
// on the site the request arrived on and needs super_admin *there* — which a super admin
// normally only holds on the primary site (see requireSuperAdmin), so it could never reset
// a tenant's pinned publisher key. This one runs from the primary site's domain and names
// the target site explicitly, the same way the rest of /api/v1/admin/sites does.
export default defineEventHandler(async (event) => {
  const { userId } = await requireSuperAdmin(event)
  const db = useDb(event)
  const siteId = getRouterParam(event, 'id')!
  const pluginId = getRouterParam(event, 'pluginId')!

  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { id: true } })
  if (!site) throw notFound('Site not found')

  const trust = await db.query.dynamicPluginTrust.findFirst({
    where: and(eq(dynamicPluginTrust.siteId, siteId), eq(dynamicPluginTrust.pluginId, pluginId)),
  })
  if (!trust) return noContent(event)

  // Audit row scoped to the target site (not the caller's), matching admin/sites/[id].patch.ts.
  await db.batch([
    db.delete(dynamicPluginTrust)
      .where(and(eq(dynamicPluginTrust.siteId, siteId), eq(dynamicPluginTrust.pluginId, pluginId))),
    db.insert(auditLogs).values({
      id: ulid(),
      siteId,
      userId,
      action: 'delete',
      resource: 'dynamic_plugin_trust',
      resourceId: pluginId,
      before: trust,
      ipAddress: getHeader(event, 'cf-connecting-ip') ?? null,
      userAgent: getHeader(event, 'user-agent') ?? null,
    }),
  ])

  return noContent(event)
})
