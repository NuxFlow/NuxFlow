import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole, roleAtLeast, AUTHOR_SETTABLE_STATUSES, assertCanEditContentItem } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { resolveSetting } from '../../../utils/settings'
import { broadcastPushToSite } from '../../../utils/webpush'
import { getContentItemOrThrow, deriveVisibilityFromSettings } from '../../../utils/content-queries'
import { contentItems, contentRevisions } from '@nuxflow/db/schema'
import { and, eq, ne, sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import { scopedById } from '../../../utils/db-helpers'
import { purgeContentCache } from '../../../utils/edge-cache'
import { getContentItemTerms } from '@nuxflow/db/queries'
import { waitUntil } from '../../../utils/cf-env'
import { upsertContentEmbedding } from '../../../utils/embeddings'
import { itemPublicPath } from '../../../utils/public-page'
import { redirectMovedPaths } from '../../../utils/redirects'
import { indexablePathsForItems, submitToIndexNow } from '../../../utils/indexnow'
import type { BatchItem } from 'drizzle-orm/batch'

const bodySchema = z.object({
  title: z.string().min(1).max(500).optional(),
  slug: z.string().min(1).max(500).optional(),
  status: z.enum(['draft', 'review', 'published', 'scheduled', 'archived']).optional(),
  content: z.unknown().optional(),
  seoTitle: z.string().max(200).optional(),
  seoDescription: z.string().max(500).optional(),
  canonicalUrl: z.string().max(2048).nullish(),
  focusKeyword: z.string().max(200).nullish(),
  metaRobots: z.enum(['index,follow', 'noindex,follow', 'noindex,nofollow', 'index,nofollow']).nullish(),
  scheduledAt: z.string().datetime().nullish(),
  settings: z.record(z.string(), z.unknown()).optional(),
  excerpt: z.string().max(2000).nullish(),
  ogImage: z.string().max(2048).nullish(),
  allowComments: z.boolean().nullable().optional(),
  locale: z.string().max(10).optional(),
  sourceItemId: z.string().nullable().optional(),
  eventStartAt: z.string().nullable().optional(),
  eventEndAt: z.string().nullable().optional(),
  eventLocation: z.string().max(500).nullable().optional(),
  eventUrl: z.string().max(2048).nullable().optional(),
  eventAllDay: z.boolean().nullable().optional(),
  // Optional optimistic lock: client sends the version it last saw.
  // Server returns 409 if the item has since been updated by someone else.
  expectedVersion: z.number().int().positive().optional(),
})

export default defineEventHandler(async (event) => {
  const { userId, role } = await requireRole(event, 'author')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const body = await parseBody(event, bodySchema)

  // Only editor+ may publish/schedule directly — mirrors the identical check already
  // enforced for the MCP `update_content` tool and for content creation.
  if (body.status && !AUTHOR_SETTABLE_STATUSES.has(body.status) && !roleAtLeast(role, 'editor')) {
    forbidden('Only an editor or higher can publish, schedule, or archive content')
  }

  const existing = await getContentItemOrThrow(db, siteId, id, 'Not found')
  assertCanEditContentItem(role, userId, existing)

  // sourceItemId links a translation to its original — it must point at an item on this
  // same site (public page translation lookups trust this link).
  if (body.sourceItemId && body.sourceItemId !== existing.sourceItemId) {
    if (body.sourceItemId === id) throw validationError('An item cannot be a translation of itself')
    await getContentItemOrThrow(db, siteId, body.sourceItemId, 'Source item not found', { id: true })
  }

  const { expectedVersion, ...updateFields } = body
  if (expectedVersion !== undefined && existing.version !== expectedVersion) {
    throw conflict('Content has been modified since you last loaded it', { currentVersion: existing.version })
  }

  if (updateFields.slug !== undefined && updateFields.slug !== existing.slug) {
    const slugConflict = await db.query.contentItems.findFirst({
      where: and(eq(contentItems.siteId, siteId), eq(contentItems.slug, updateFields.slug), ne(contentItems.id, id)),
      columns: { id: true },
    })
    if (slugConflict) conflict(`A content item with the slug "${updateFields.slug}" already exists`)
  }

  const nextVersion = existing.version + 1

  // `settings.access` (the editor's "Content access" control) is the source of truth for
  // gating; `visibility` is what the public gate actually checks, so keep it derived from
  // settings on every write that touches settings — never left stale at its 'public' default.
  const visibility = updateFields.settings !== undefined
    ? deriveVisibilityFromSettings(updateFields.settings)
    : undefined

  // Snapshot a revision only when this edit actually changes title/content — the editor
  // autosaves every 10s of idle time regardless of whether anything changed, and every
  // other field (SEO, settings, scheduling, etc.) already has its own history via the
  // audit log, so snapshotting the full title+content pair on every such no-op autosave
  // just inflates content_revisions without capturing anything new.
  const titleChanged = updateFields.title !== undefined && updateFields.title !== existing.title
  const contentChanged = updateFields.content !== undefined
    && JSON.stringify(updateFields.content) !== JSON.stringify(existing.content)
  const shouldSnapshotRevision = titleChanged || contentChanged

  const itemUpdate = db.update(contentItems)
    .set({
      ...updateFields,
      ...(visibility !== undefined ? { visibility } : {}),
      version: nextVersion,
      updatedAt: sql`(datetime('now'))`,
      publishedAt: updateFields.status === 'published' && !existing.publishedAt
        ? sql`(datetime('now'))`
        : existing.publishedAt,
    })
    .where(scopedById(contentItems.id, id, contentItems.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'update',
    resource: 'content_item',
    resourceId: id,
    before: existing,
    after: updateFields,
  })

  // One D1 round trip instead of three — none of these writes depend on
  // each other's result, only on `existing`, which is already loaded above.
  const writes: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] = shouldSnapshotRevision
    ? [db.insert(contentRevisions).values({
        id: ulid(),
        itemId: id,
        authorId: userId,
        title: existing.title,
        content: existing.content,
      }), itemUpdate]
    : [itemUpdate]
  await batchWithAudit(db, writes, auditInsert)

  // Public URL bookkeeping. A translation is served at /{locale}/{source slug}, and a
  // source item's slug change moves every one of its translations' URLs with it.
  const nextItem = {
    slug: updateFields.slug ?? existing.slug,
    locale: updateFields.locale ?? existing.locale,
    sourceItemId: updateFields.sourceItemId !== undefined ? updateFields.sourceItemId : existing.sourceItemId,
  }
  const [oldPath, newPath] = await Promise.all([itemPublicPath(db, siteId, existing), itemPublicPath(db, siteId, nextItem)])
  const moves: { from: string; to: string }[] = []
  const slugChanged = updateFields.slug !== undefined && updateFields.slug !== existing.slug
  if (slugChanged) {
    moves.push({ from: `/${existing.slug}`, to: newPath })
    if (oldPath !== `/${existing.slug}`) moves.push({ from: oldPath, to: newPath })
    if (!existing.sourceItemId) {
      const translations = await db.query.contentItems.findMany({
        where: and(eq(contentItems.siteId, siteId), eq(contentItems.sourceItemId, id)),
        columns: { locale: true },
      })
      for (const t of translations) {
        moves.push({
          from: existing.slug === 'home' ? `/${t.locale}` : `/${t.locale}/${existing.slug}`,
          to: nextItem.slug === 'home' ? `/${t.locale}` : `/${t.locale}/${nextItem.slug}`,
        })
      }
    }
  }

  // A published URL that moves keeps its search ranking and inbound links only if the old
  // address 301s to the new one — done automatically (and chain-flattened) here rather
  // than left for someone to remember in Admin → SEO → Redirects.
  if (moves.length > 0 && existing.status === 'published') {
    await redirectMovedPaths(db, siteId, moves)
  }

  const terms = await getContentItemTerms(db, id)
  await purgeContentCache(event, {
    slugs: [existing.slug, updateFields.slug].filter((s): s is string => Boolean(s)),
    taxonomyTerms: terms.map(t => ({ taxonomySlug: t.taxonomySlug, termSlug: t.termSlug })),
    extraPaths: [oldPath, newPath, ...moves.flatMap(m => [m.from, m.to])],
  })

  // IndexNow: tell participating search engines about a live URL's change (or its
  // removal, on unpublish/archive/visibility change). Throttled per URL inside
  // submitToIndexNow, since the editor autosaves published pages repeatedly.
  const nextStatus = updateFields.status ?? existing.status
  const nextVisibility = visibility ?? existing.visibility
  if (nextStatus === 'published' || existing.status === 'published') {
    waitUntil(event, (async () => {
      const paths = nextStatus === 'published' && nextVisibility === 'public'
        ? await indexablePathsForItems(db, siteId, [{ ...nextItem, typeId: existing.typeId, metaRobots: updateFields.metaRobots !== undefined ? updateFields.metaRobots : existing.metaRobots }])
        : [newPath]
      if (existing.status === 'published') paths.push(...moves.map(m => m.from))
      await submitToIndexNow(db, siteId, paths)
    })().catch(err => console.error('[indexnow] Content update notification failed:', err)))
  }

  // Re-embed with the fully-merged state (fields not touched by this PATCH keep their
  // existing value) — not just updateFields, which would otherwise treat every untouched
  // field as blank and silently regress a previously-good embedding.
  waitUntil(event, upsertContentEmbedding(event, {
    contentItemId: id,
    siteId,
    title: updateFields.title ?? existing.title,
    excerpt: updateFields.excerpt !== undefined ? updateFields.excerpt : existing.excerpt,
    seoDescription: updateFields.seoDescription ?? existing.seoDescription,
    status: updateFields.status ?? existing.status,
    visibility: visibility !== undefined ? visibility : existing.visibility,
  }))

  // Push broadcast when content is first published
  const isFirstPublish = updateFields.status === 'published' && existing.status !== 'published'
  if (isFirstPublish) {
    const enabled = await resolveSetting(event, 'push.events.content_published')
    if (enabled === 'true') {
      waitUntil(event, broadcastPushToSite(event, {
        title: body.title ?? existing.title,
        body: 'New content has been published.',
        url: `/${updateFields.slug ?? existing.slug}`,
      }).catch(err => console.error('[push] Content publish broadcast failed:', err)))
    }
  }

  return { id, version: nextVersion }
})
