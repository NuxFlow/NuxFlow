import { useDb } from '../../../../../../utils/db'
import { requireRole } from '../../../../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../../../../utils/audit'
import { getContentItemOrThrow } from '../../../../../../utils/content-queries'
import { contentRevisions, contentItems } from '@nuxflow/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import { scopedById } from '../../../../../../utils/db-helpers'
import { purgeContentCache } from '../../../../../../utils/edge-cache'
import { itemPublicPath } from '../../../../../../utils/public-page'
import { waitUntil } from '../../../../../../utils/cf-env'
import { upsertContentEmbedding } from '../../../../../../utils/embeddings'
import { indexablePathsForItems, submitToIndexNow } from '../../../../../../utils/indexnow'
import { queueContentHook } from '../../../../../../utils/plugin-hooks'
import { requireSiteId } from '../../../../../../utils/site-context'

/**
 * Puts an earlier title + body back. Same bookkeeping as an ordinary save that changes
 * them (content/[id].patch.ts): the current version is kept as a revision first — a
 * restore used to overwrite it with no way back — the version is bumped so an editor tab
 * holding the old text notices, and a live page's cached copy is cleared, its search
 * entry refreshed and plugins told.
 */
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const id = getRouterParam(event, 'id')!
  const revisionId = getRouterParam(event, 'revisionId')!

  const existing = await getContentItemOrThrow(db, siteId, id, 'Content item not found')

  const revision = await db.query.contentRevisions.findFirst({
    where: and(eq(contentRevisions.id, revisionId), eq(contentRevisions.itemId, id)),
  })
  if (!revision) throw notFound('Revision not found')

  if (revision.title === existing.title && JSON.stringify(revision.content) === JSON.stringify(existing.content)) {
    return { success: true, version: existing.version }
  }

  const nextVersion = existing.version + 1
  const snapshot = db.insert(contentRevisions).values({
    id: ulid(),
    itemId: id,
    authorId: userId,
    title: existing.title,
    content: existing.content,
    summary: 'Before restoring an earlier version',
  })
  const itemUpdate = db.update(contentItems)
    .set({ title: revision.title, content: revision.content, version: nextVersion, updatedAt: sql`(datetime('now'))` })
    .where(scopedById(contentItems.id, id, contentItems.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, { action: 'restore', resource: 'content_revision', resourceId: revisionId })
  await batchWithAudit(db, [snapshot, itemUpdate], auditInsert)

  if (existing.status === 'published') {
    const path = await itemPublicPath(db, siteId, existing)
    await purgeContentCache(event, { published: true, slugs: [existing.slug], extraPaths: [path] })

    if (existing.visibility === 'public') {
      waitUntil(event, indexablePathsForItems(db, siteId, [existing])
        .then(paths => submitToIndexNow(db, siteId, paths))
        .catch(err => console.error('[indexnow] Revision restore notification failed:', err)))
    }
    if (revision.title !== existing.title) {
      waitUntil(event, upsertContentEmbedding(event, {
        contentItemId: id,
        siteId,
        title: revision.title,
        excerpt: existing.excerpt,
        seoDescription: existing.seoDescription,
        status: existing.status,
        visibility: existing.visibility,
      }))
    }
  }

  const state = { status: existing.status, visibility: existing.visibility }
  queueContentHook(event, siteId, state, state, {
    id,
    typeId: existing.typeId,
    title: revision.title,
    slug: existing.slug,
    locale: existing.locale,
    sourceItemId: existing.sourceItemId,
    publishedAt: existing.publishedAt,
  })

  return { success: true, version: nextVersion }
})
