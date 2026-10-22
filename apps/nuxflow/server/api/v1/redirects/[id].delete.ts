import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { getRedirectByIdOrThrow } from '../../../utils/resource-queries'
import { redirects } from '@nuxflow/db/schema'
import { scopedById } from '../../../utils/db-helpers'
import { clearRedirectCache } from '../../../utils/redirect-cache'
import { requireSiteId } from '../../../utils/site-context'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const id = getRouterParam(event, 'id')!

  const existing = await getRedirectByIdOrThrow(db, siteId, id)

  const redirectDelete = db.delete(redirects).where(scopedById(redirects.id, id, redirects.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'delete',
    resource: 'redirect',
    resourceId: id,
    before: existing,
  })

  await batchWithAudit(db, [redirectDelete], auditInsert)
  clearRedirectCache(siteId)

  return noContent(event)
})
