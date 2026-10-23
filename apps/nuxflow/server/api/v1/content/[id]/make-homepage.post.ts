import { and, eq, ne, sql } from 'drizzle-orm'
import { contentItems } from '@nuxflow/db/schema'
import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../../utils/audit'
import { getContentItemOrThrow, uniqueContentSlug } from '../../../../utils/content-queries'
import { purgeContentCache } from '../../../../utils/edge-cache'
import { redirectMovedPaths } from '../../../../utils/redirects'
import { waitUntil } from '../../../../utils/cf-env'
import { upsertContentEmbedding } from '../../../../utils/embeddings'
import { indexablePathsForItems, submitToIndexNow } from '../../../../utils/indexnow'
import { queueContentHook } from '../../../../utils/plugin-hooks'
import { queueContentPublishedPush } from '../../../../utils/push-content'
import { requireSiteId } from '../../../../utils/site-context'

/**
 * Publishes an item as the site's homepage — the Generate with AI review screen's
 * "Publish as homepage". The homepage is whichever item has the slug `home` (seo.ts,
 * publicPathForItem), and setup already makes one, so a generated home page is saved as
 * `home-2` and can't simply be renamed: the current homepage moves to `previous-home` as
 * a draft (nothing is lost), and this item takes `home` and goes live. Both changes are
 * one batch, so the site is never left without a homepage between them.
 */
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const id = getRouterParam(event, 'id')!

  const item = await getContentItemOrThrow(db, siteId, id, 'Not found')
  if (item.sourceItemId) {
    validationError('A translation can\'t be the homepage — make its original page the homepage instead')
  }
  if (item.slug === 'home' && item.status === 'published') return { id, previousHome: null }

  const current = await db.query.contentItems.findFirst({
    where: and(eq(contentItems.siteId, siteId), eq(contentItems.slug, 'home'), ne(contentItems.id, id)),
  })
  const previousSlug = current ? await uniqueContentSlug(db, siteId, 'previous-home') : null

  const writes = []
  if (current) {
    // First, so `home` is free for the item below (slugs are unique per site).
    writes.push(db.update(contentItems)
      .set({ slug: previousSlug!, status: 'draft', version: sql`${contentItems.version} + 1`, updatedAt: sql`(datetime('now'))` })
      .where(and(eq(contentItems.id, current.id), eq(contentItems.siteId, siteId))))
    const currentAudit = buildAuditLogInsert(event, userId, {
      action: 'update',
      resource: 'content_item',
      resourceId: current.id,
      before: { slug: current.slug, status: current.status },
      after: { slug: previousSlug, status: 'draft', reason: 'replaced as homepage' },
    })
    if (currentAudit) writes.push(currentAudit)
  }
  writes.push(db.update(contentItems)
    .set({
      slug: 'home',
      status: 'published',
      publishedAt: item.publishedAt ?? sql`(datetime('now'))`,
      version: sql`${contentItems.version} + 1`,
      updatedAt: sql`(datetime('now'))`,
    })
    .where(and(eq(contentItems.id, id), eq(contentItems.siteId, siteId))))
  await batchWithAudit(db, writes, buildAuditLogInsert(event, userId, {
    action: 'update',
    resource: 'content_item',
    resourceId: id,
    before: { slug: item.slug, status: item.status },
    after: { slug: 'home', status: 'published', reason: 'made homepage' },
  }))

  // A page that was already live keeps its inbound links: its old address 301s to /.
  if (item.status === 'published') await redirectMovedPaths(db, siteId, [{ from: `/${item.slug}`, to: '/' }])

  await purgeContentCache(event, {
    published: true,
    slugs: ['home', item.slug, ...(previousSlug ? [previousSlug] : [])],
    extraPaths: ['/', `/${item.slug}`],
  })

  waitUntil(event, (async () => {
    const paths = item.visibility === 'public'
      ? await indexablePathsForItems(db, siteId, [{ slug: 'home', locale: item.locale, sourceItemId: null, typeId: item.typeId, metaRobots: item.metaRobots }])
      : []
    if (item.status === 'published') paths.push(`/${item.slug}`)
    await submitToIndexNow(db, siteId, paths)
  })().catch(err => console.error('[indexnow] Homepage change notification failed:', err)))

  const now = new Date().toISOString()
  waitUntil(event, upsertContentEmbedding(event, { contentItemId: id, siteId, title: item.title, excerpt: item.excerpt, seoDescription: item.seoDescription, status: 'published', visibility: item.visibility }))
  queueContentHook(event, siteId, item, { status: 'published', visibility: item.visibility }, {
    id, typeId: item.typeId, title: item.title, slug: 'home', locale: item.locale, sourceItemId: null, publishedAt: item.publishedAt ?? now,
  })
  queueContentPublishedPush(event, siteId, item, { status: 'published', visibility: item.visibility }, {
    title: item.title, slug: 'home', locale: item.locale, sourceItemId: null,
  })

  if (current) {
    waitUntil(event, upsertContentEmbedding(event, { contentItemId: current.id, siteId, title: current.title, excerpt: current.excerpt, seoDescription: current.seoDescription, status: 'draft', visibility: current.visibility }))
    queueContentHook(event, siteId, current, { status: 'draft', visibility: current.visibility }, {
      id: current.id, typeId: current.typeId, title: current.title, slug: previousSlug!, locale: current.locale, sourceItemId: null, publishedAt: current.publishedAt,
    })
  }

  return { id, previousHome: current ? { id: current.id, title: current.title, slug: previousSlug } : null }
})
