import { useDb } from '../../../utils/db'
import { requireAuth, canEditContentItem } from '../../../utils/permissions'
import { getContentItemOrThrow } from '../../../utils/content-queries'
import { contentTypes } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { userId, role } = await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const item = await getContentItemOrThrow(db, siteId, id, 'Not found')

  const type = await db.query.contentTypes.findFirst({
    where: eq(contentTypes.id, item.typeId),
    columns: { hasComments: true, slug: true },
  })

  // Lets the editor show a read-only notice up front instead of failing on save —
  // PATCH enforces the same rule (canEditContentItem) server-side.
  return {
    ...item,
    typeHasComments: type?.hasComments ?? false,
    typeSlug: type?.slug ?? 'page',
    canEdit: canEditContentItem(role, userId, item),
  }
})
