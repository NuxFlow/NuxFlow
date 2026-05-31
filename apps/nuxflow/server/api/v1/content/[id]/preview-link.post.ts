import { useDb } from '../../../../utils/db'
import { contentItems } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { requireRole } from '../../../../utils/permissions'
import { writeAuditLog } from '../../../../utils/audit'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'author')
  const siteId = event.context.siteId!
  const id = getRouterParam(event, 'id')!

  const db = useDb(event)

  const token = crypto.randomUUID().replace(/-/g, '')
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()

  const updated = await db
    .update(contentItems)
    .set({ previewToken: token, previewTokenExpiresAt: expiresAt })
    .where(and(eq(contentItems.id, id), eq(contentItems.siteId, siteId)))
    .returning({ id: contentItems.id })

  if (!updated.length) throw createError({ statusCode: 404, message: 'Content not found' })

  const config = useRuntimeConfig()
  const baseUrl = config.public.siteUrl || 'http://localhost:3000'

  void writeAuditLog(event, userId, {
    action: 'generate',
    resource: 'preview_link',
    resourceId: id,
  })

  return { url: `${baseUrl}/api/preview/${token}` }
})
