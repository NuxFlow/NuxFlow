import { useDb } from '../../../utils/db'
import { requireAuth, canEditContentItem } from '../../../utils/permissions'
import { getContentItemOrThrow } from '../../../utils/content-queries'
import { contentTypes } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { getContentTermIds } from '../../../utils/taxonomy'
import { settingsForEditor } from '../../../utils/page-password'
import { requireSiteId } from '../../../utils/site-context'

export default defineEventHandler(async (event) => {
  const { userId, role } = await requireAuth(event)
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const id = getRouterParam(event, 'id')!

  const item = await getContentItemOrThrow(db, siteId, id, 'Not found')

  const [type, termIds] = await Promise.all([
    db.query.contentTypes.findFirst({
      where: and(eq(contentTypes.id, item.typeId), eq(contentTypes.siteId, siteId)),
      columns: { hasComments: true, slug: true },
    }),
    getContentTermIds(db, id),
  ])

  // Lets the editor show a read-only notice up front instead of failing on save —
  // PATCH enforces the same rule (canEditContentItem) server-side.
  return {
    ...item,
    // The page password's hash never leaves the server; the editor only needs to know one is set.
    settings: settingsForEditor(item.settings as Record<string, unknown> | null),
    typeHasComments: type?.hasComments ?? false,
    typeSlug: type?.slug ?? 'page',
    termIds,
    canEdit: canEditContentItem(role, userId, item),
  }
})
