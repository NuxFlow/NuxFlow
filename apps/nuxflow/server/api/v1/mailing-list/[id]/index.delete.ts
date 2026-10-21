import { and, eq } from 'drizzle-orm'
import { mailingListSubscribers } from '@nuxflow/db/schema'
import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { writeAuditLog } from '../../../../utils/audit'

// Erase someone from the list entirely (a GDPR erasure request). To stop mailing someone
// but remember that they left, mark them unsubscribed instead (PATCH).
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const deleted = await db.delete(mailingListSubscribers)
    .where(and(eq(mailingListSubscribers.id, id), eq(mailingListSubscribers.siteId, siteId)))
    .returning({ id: mailingListSubscribers.id })
  if (deleted.length === 0) notFound()

  // The address itself isn't written to the audit log — that would keep the personal data
  // the deletion is meant to remove.
  await writeAuditLog(event, userId, { action: 'delete', resource: 'mailing_list_subscriber', resourceId: id })
  return noContent(event)
})
