import { z } from 'zod'
import { formSubmissions } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../utils/db'
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
    .where(and(eq(formSubmissions.id, id), eq(formSubmissions.siteId, siteId)))

  return { success: true }
})
