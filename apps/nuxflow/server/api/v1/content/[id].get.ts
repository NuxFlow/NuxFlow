import { useDb } from '../../../utils/db'
import { requireAuth, canEditContentItem } from '../../../utils/permissions'
import { getContentItemOrThrow } from '../../../utils/content-queries'
import { contentTypes } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { getContentTermIds } from '../../../utils/taxonomy'

export default defineEventHandler(async (event) => {
  const { userId, role } = await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const item = await getContentItemOrThrow(db, siteId, id, 'Not found')

  const [type, termIds] = await Promise.all([
    db.query.contentTypes.findFirst({
      where: eq(contentTypes.id, item.typeId),
      columns: { hasComments: true, slug: true },
    }),
    getContentTermIds(db, id),
  ])

  // Lets the editor show a read-only notice up front instead of failing on save —
  // PATCH enforces the same rule (canEditContentItem) server-side.
  return {
    ...item,
    typeHasComments: type?.hasComments ?? false,
    typeSlug: type?.slug ?? 'page',
    termIds,
    canEdit: canEditContentItem(role, userId, item),
  }
})
