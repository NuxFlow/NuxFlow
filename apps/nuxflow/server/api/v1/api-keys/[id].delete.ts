import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { getApiKeyByIdOrThrow } from '../../../utils/resource-queries'
import { apiKeys } from '@nuxflow/db/schema'
import { scopedById } from '../../../utils/db-helpers'
import { requireSiteId } from '../../../utils/site-context'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const id = getRouterParam(event, 'id')!

  const existing = await getApiKeyByIdOrThrow(db, siteId, id, 'API key not found', { id: true, name: true, scopes: true })

  const keyDelete = db.delete(apiKeys).where(scopedById(apiKeys.id, id, apiKeys.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'delete',
    resource: 'api_key',
    resourceId: id,
    before: existing,
  })

  await batchWithAudit(db, [keyDelete], auditInsert)

  return noContent(event)
})
