import { useDb } from '../../../../utils/db'
import { requireAuth } from '../../../../utils/permissions'
import { getContentItemOrThrow } from '../../../../utils/content-queries'
import { contentRevisions } from '@nuxflow/db/schema'
import { eq, desc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  await getContentItemOrThrow(db, siteId, id, 'Not found', { id: true })

  const revisions = await db.query.contentRevisions.findMany({
    where: eq(contentRevisions.itemId, id),
    orderBy: [desc(contentRevisions.createdAt)],
    columns: { id: true, title: true, summary: true, createdAt: true, authorId: true },
  })

  return { revisions }
})
