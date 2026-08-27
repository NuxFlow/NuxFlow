import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { writeAuditLog } from '../../../utils/audit'
import { redirects } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const existing = await db.query.redirects.findFirst({
    where: and(eq(redirects.id, id), eq(redirects.siteId, siteId)),
  })

  await db.delete(redirects).where(and(eq(redirects.id, id), eq(redirects.siteId, siteId)))

  await writeAuditLog(event, userId, {
    action: 'delete',
    resource: 'redirect',
    resourceId: id,
    before: existing,
  })

  return { success: true }
})
