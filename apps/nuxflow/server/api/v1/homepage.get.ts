import { contentItems, contentTypes } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { useDb } from '../../utils/db'
import { requireRole } from '../../utils/permissions'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const type = await db.query.contentTypes.findFirst({
    where: and(eq(contentTypes.siteId, siteId), eq(contentTypes.slug, 'page')),
    columns: { id: true },
  })

  if (!type) return { homepage: null }

  const page = await db.query.contentItems.findFirst({
    where: and(
      eq(contentItems.siteId, siteId),
      eq(contentItems.typeId, type.id),
      eq(contentItems.slug, 'home'),
    ),
    columns: { id: true, title: true, content: true, updatedAt: true },
  })

  return {
    homepage: page
      ? { id: page.id, title: page.title, hasCustomContent: page.content !== null, updatedAt: page.updatedAt }
      : null,
  }
})
