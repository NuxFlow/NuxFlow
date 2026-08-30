import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert } from '../../../utils/audit'
import { getRedirectByIdOrThrow } from '../../../utils/resource-queries'
import { redirects } from '@nuxflow/db/schema'
import { scopedById } from '../../../utils/db-helpers'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const existing = await getRedirectByIdOrThrow(db, siteId, id)

  const redirectDelete = db.delete(redirects).where(scopedById(redirects.id, id, redirects.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'delete',
    resource: 'redirect',
    resourceId: id,
    before: existing,
  })

  await db.batch(auditInsert ? [redirectDelete, auditInsert] : [redirectDelete])

  return noContent(event)
})
