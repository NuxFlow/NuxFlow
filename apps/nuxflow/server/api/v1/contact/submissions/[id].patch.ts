import { z } from 'zod'
import { formSubmissions } from '@nuxflow/db/schema'
import { useDb } from '../../../../utils/db'
import { scopedById } from '../../../../utils/db-helpers'
import { requireRole } from '../../../../utils/permissions'
import { getFormSubmissionByIdOrThrow } from '../../../../utils/resource-queries'
import { buildAuditLogInsert, batchWithAudit } from '../../../../utils/audit'

const bodySchema = z.object({
  status: z.enum(['new', 'read', 'spam', 'archived']),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const body = await parseBody(event, bodySchema)

  const existing = await getFormSubmissionByIdOrThrow(db, siteId, id, 'Submission not found', { id: true, status: true })

  const statusUpdate = db.update(formSubmissions)
    .set({ status: body.status })
    .where(scopedById(formSubmissions.id, id, formSubmissions.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'update',
    resource: 'form_submission',
    resourceId: id,
    before: existing,
    after: body,
  })

  await batchWithAudit(db, [statusUpdate], auditInsert)

  return { success: true }
})
