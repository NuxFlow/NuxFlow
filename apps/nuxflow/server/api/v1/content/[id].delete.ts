import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { getContentItemOrThrow } from '../../../utils/content-queries'
import { contentItems } from '@nuxflow/db/schema'
import { scopedById } from '../../../utils/db-helpers'
import { purgeContentCache } from '../../../utils/edge-cache'
import { getContentItemTerms } from '@nuxflow/db/queries'
import { waitUntil } from '../../../utils/cf-env'
import { deleteContentEmbedding } from '../../../utils/embeddings'
import { indexablePathsForItems, submitToIndexNow } from '../../../utils/indexnow'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const existing = await getContentItemOrThrow(db, siteId, id, 'Not found', {
    id: true, title: true, slug: true, status: true, visibility: true, locale: true, sourceItemId: true, typeId: true, metaRobots: true,
  })
  const terms = await getContentItemTerms(db, id)
  // Resolved before the delete — a translation's public path needs its source row.
  const wasLive = existing.status === 'published' && existing.visibility === 'public'
  const livePaths = wasLive ? await indexablePathsForItems(db, siteId, [existing]) : []

  const itemDelete = db.delete(contentItems)
    .where(scopedById(contentItems.id, id, contentItems.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'delete',
    resource: 'content_item',
    resourceId: id,
    before: existing,
  })

  await batchWithAudit(db, [itemDelete], auditInsert)

  await purgeContentCache(event, {
    slugs: [existing.slug],
    extraPaths: livePaths,
    taxonomyTerms: terms.map(t => ({ taxonomySlug: t.taxonomySlug, termSlug: t.termSlug })),
  })

  waitUntil(event, deleteContentEmbedding(event, id))
  // IndexNow accepts removed URLs too — engines drop them on their next fetch (a 404).
  if (livePaths.length) {
    waitUntil(event, submitToIndexNow(db, siteId, livePaths).catch(err => console.error('[indexnow] Content delete notification failed:', err)))
  }

  return noContent(event)
})
