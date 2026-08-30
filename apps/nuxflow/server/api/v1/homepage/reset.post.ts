import { contentItems } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { getContentTypeBySlugOrThrow } from '../../../utils/content-queries'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const type = await getContentTypeBySlugOrThrow(db, siteId, 'page', 'Page content type not found', { id: true })

  const page = await db.query.contentItems.findFirst({
    where: and(
      eq(contentItems.siteId, siteId),
      eq(contentItems.typeId, type.id),
      eq(contentItems.slug, 'home'),
    ),
    columns: { id: true },
  })
  if (!page) throw notFound('Homepage not found')

  await db.update(contentItems)
    .set({ content: null, updatedAt: new Date().toISOString() })
    .where(and(eq(contentItems.id, page.id), eq(contentItems.siteId, siteId)))

  return { success: true }
})
