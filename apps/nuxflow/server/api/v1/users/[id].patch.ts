import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { userSiteRoles } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { requireRole } from '../../../utils/permissions'
import { writeAuditLog } from '../../../utils/audit'

const bodySchema = z.object({
  role: z.enum(['admin', 'editor', 'author', 'viewer', 'member']).optional(),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const siteId = event.context.siteId!
  const targetId = getRouterParam(event, 'id')!

  const body = await readValidatedBody(event, bodySchema.parse)
  const db = useDb(event)

  if (body.role) {
    const existing = await db.query.userSiteRoles.findFirst({
      where: and(eq(userSiteRoles.userId, targetId), eq(userSiteRoles.siteId, siteId)),
    })

    await db
      .update(userSiteRoles)
      .set({ role: body.role })
      .where(and(eq(userSiteRoles.userId, targetId), eq(userSiteRoles.siteId, siteId)))

    void writeAuditLog(event, userId, {
      action: 'update',
      resource: 'user',
      resourceId: targetId,
      before: existing ? { role: existing.role } : undefined,
      after: { role: body.role },
    })
  }

  return { success: true }
})
