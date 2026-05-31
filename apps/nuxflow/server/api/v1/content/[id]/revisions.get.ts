import { useDb } from '../../../../utils/db'
import { requireAuth } from '../../../../utils/permissions'
import { contentRevisions, contentItems } from '@nuxflow/db/schema'
import { and, eq, desc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const item = await db.query.contentItems.findFirst({
    where: and(eq(contentItems.id, id), eq(contentItems.siteId, siteId)),
    columns: { id: true },
  })
  if (!item) throw createError({ statusCode: 404, message: 'Not found' })

  const revisions = await db.query.contentRevisions.findMany({
    where: eq(contentRevisions.itemId, id),
    orderBy: [desc(contentRevisions.createdAt)],
    columns: { id: true, title: true, summary: true, createdAt: true, authorId: true },
  })

  return { revisions }
})
