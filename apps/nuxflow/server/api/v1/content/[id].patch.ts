import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { resolveSetting } from '../../../utils/settings'
import { broadcastPushToSite } from '../../../utils/webpush'
import { getContentItemOrThrow, deriveVisibilityFromSettings } from '../../../utils/content-queries'
import { contentItems, contentRevisions } from '@nuxflow/db/schema'
import { sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import { scopedById } from '../../../utils/db-helpers'
import { purgeContentCache } from '../../../utils/edge-cache'
import { getContentItemTerms } from '@nuxflow/db/queries'
import { waitUntil } from '../../../utils/cf-env'
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
  const { userId } = await requireRole(event, 'author')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const body = await parseBody(event, bodySchema)

  const existing = await getContentItemOrThrow(db, siteId, id, 'Not found')

  const { expectedVersion, ...updateFields } = body
  if (expectedVersion !== undefined && existing.version !== expectedVersion) {
    throw conflict('Content has been modified since you last loaded it', { currentVersion: existing.version })
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

  const terms = await getContentItemTerms(db, id)
  await purgeContentCache(event, {
    slugs: [existing.slug, updateFields.slug].filter((s): s is string => Boolean(s)),
    taxonomyTerms: terms.map(t => ({ taxonomySlug: t.taxonomySlug, termSlug: t.termSlug })),
  })

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
