import { z } from 'zod'
import { formSubmissions } from '@nuxflow/db/schema'
import { useDb } from '../../../../utils/db'
import { scopedById } from '../../../../utils/db-helpers'
import { requireRole } from '../../../../utils/permissions'
import { getFormSubmissionByIdOrThrow } from '../../../../utils/resource-queries'

const bodySchema = z.object({
  status: z.enum(['new', 'read', 'spam', 'archived']),
})

export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const body = await parseBody(event, bodySchema)

  await getFormSubmissionByIdOrThrow(db, siteId, id, 'Submission not found', { id: true })

  await db.update(formSubmissions)
    .set({ status: body.status })
    .where(scopedById(formSubmissions.id, id, formSubmissions.siteId, siteId))

  return { success: true }
})
