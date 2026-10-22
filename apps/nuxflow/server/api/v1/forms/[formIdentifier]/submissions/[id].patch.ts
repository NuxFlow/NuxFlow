import { z } from 'zod'
import { formSubmissions } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../../utils/db'
import { requireRole } from '../../../../../utils/permissions'
import { getFormByIdOrThrow } from '../../../../../utils/resource-queries'
import { buildAuditLogInsert, batchWithAudit } from '../../../../../utils/audit'
import { requireSiteId } from '../../../../../utils/site-context'

// Sets a submission's inbox status (Admin → Forms → Submissions). Works for every form,
// including the built-in contact form; the submission must belong to the form in the URL.
const bodySchema = z.object({
  status: z.enum(['new', 'read', 'spam', 'archived']),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const formIdentifier = getRouterParam(event, 'formIdentifier')!
  const id = getRouterParam(event, 'id')!
  const body = await parseBody(event, bodySchema)

  const form = await getFormByIdOrThrow(db, siteId, formIdentifier, 'Form not found', { id: true })
  const scope = and(eq(formSubmissions.id, id), eq(formSubmissions.formId, form.id), eq(formSubmissions.siteId, siteId))

  const existing = await db.query.formSubmissions.findFirst({ where: scope, columns: { id: true, status: true } })
  if (!existing) throw notFound('Submission not found')

  const statusUpdate = db.update(formSubmissions).set({ status: body.status }).where(scope)
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
