import { contentItems } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { useDb } from '../../utils/db'
import { requireRole } from '../../utils/permissions'
import { getContentTypeBySlug } from '../../utils/content-queries'
import { requireSiteId } from '../../utils/site-context'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = requireSiteId(event)

  const type = await getContentTypeBySlug(db, siteId, 'page', { id: true })

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
