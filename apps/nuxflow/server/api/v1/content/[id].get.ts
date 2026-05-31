import { useDb } from '../../../utils/db'
import { requireAuth } from '../../../utils/permissions'
import { contentItems, contentTypes } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const item = await db.query.contentItems.findFirst({
    where: and(eq(contentItems.id, id), eq(contentItems.siteId, siteId)),
  })

  if (!item) throw createError({ statusCode: 404, message: 'Not found' })

  const type = await db.query.contentTypes.findFirst({
    where: eq(contentTypes.id, item.typeId),
    columns: { hasComments: true },
  })

  return { ...item, typeHasComments: type?.hasComments ?? false }
})
