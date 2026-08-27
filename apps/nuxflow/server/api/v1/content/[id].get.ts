import { useDb } from '../../../utils/db'
import { requireAuth } from '../../../utils/permissions'
import { getContentItemOrThrow } from '../../../utils/content-queries'
import { contentTypes } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const item = await getContentItemOrThrow(db, siteId, id, 'Not found')

  const type = await db.query.contentTypes.findFirst({
    where: eq(contentTypes.id, item.typeId),
    columns: { hasComments: true, slug: true },
  })

  return { ...item, typeHasComments: type?.hasComments ?? false, typeSlug: type?.slug ?? 'page' }
})
