import { useDb } from '../../../../utils/db'
import { requireAuth } from '../../../../utils/permissions'
import { getContentItemOrThrow } from '../../../../utils/content-queries'
import { contentRevisions } from '@nuxflow/db/schema'
import { eq, desc } from 'drizzle-orm'

// The nightly prune-old-data task caps stored revisions at 20/item, but that only runs
// once a day — a single active editing session (autosave every 10s idle) can put far more
// than that in front of this endpoint before the next prune. Cap the response itself so
// the revision history panel can never render/transfer an unbounded list.
const MAX_REVISIONS_RETURNED = 50

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
    limit: MAX_REVISIONS_RETURNED,
  })

  return { revisions }
})
