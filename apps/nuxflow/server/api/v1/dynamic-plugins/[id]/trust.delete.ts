import { useDb } from '../../../../utils/db'
import { requireSuperAdmin } from '../../../../utils/permissions'
import { buildAuditLogInsert } from '../../../../utils/audit'
import { dynamicPluginTrust } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

// Clears a plugin's pinned publisher key so the next install can register a new one —
// the deliberate escape hatch for legitimate key rotation (see index.post.ts). Requires
// super admin specifically, a higher bar than the site `admin` role that install/enable/
// disable/delete use, since this is loosening a security control rather than exercising one.
export default defineEventHandler(async (event) => {
  const { userId } = await requireSuperAdmin(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const trust = await db.query.dynamicPluginTrust.findFirst({
    where: and(eq(dynamicPluginTrust.siteId, siteId), eq(dynamicPluginTrust.pluginId, id)),
  })
  if (!trust) return noContent(event)

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'delete',
    resource: 'dynamic_plugin_trust',
    resourceId: id,
    before: trust,
  })

  const deleteQuery = db.delete(dynamicPluginTrust)
    .where(and(eq(dynamicPluginTrust.siteId, siteId), eq(dynamicPluginTrust.pluginId, id)))

  await db.batch(auditInsert ? [deleteQuery, auditInsert] : [deleteQuery])

  return noContent(event)
})
