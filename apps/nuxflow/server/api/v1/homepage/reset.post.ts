import { contentItems, contentTypes } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const type = await db.query.contentTypes.findFirst({
    where: and(eq(contentTypes.siteId, siteId), eq(contentTypes.slug, 'page')),
    columns: { id: true },
  })
  if (!type) throw createError({ statusCode: 404, message: 'Page content type not found' })

  const page = await db.query.contentItems.findFirst({
    where: and(
      eq(contentItems.siteId, siteId),
      eq(contentItems.typeId, type.id),
      eq(contentItems.slug, 'home'),
    ),
    columns: { id: true },
  })
  if (!page) throw createError({ statusCode: 404, message: 'Homepage not found' })

  await db.update(contentItems)
    .set({ content: null, updatedAt: new Date().toISOString() })
    .where(and(eq(contentItems.id, page.id), eq(contentItems.siteId, siteId)))

  return { success: true }
})
