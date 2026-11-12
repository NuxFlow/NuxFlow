// ── Content types + content items restore ─────────────────────────────────────
import { and, eq, inArray } from 'drizzle-orm'
import { contentTypes, contentItems, contentTaxonomyTerms } from '@nuxflow/db/schema'
import { parseFieldDefs } from '../../../shared/lib/custom-fields'
import { ulid } from 'ulid'
import type { Db } from '../db'
import { checkPlanLimit } from '../hosting-plans'
import { noteLimit } from './plan-limits'
import type { NuxFlowBackup, RestoreOptions, RestoreResult } from '../backup-types'
import { archiveSuffix, freeArchiveSlug } from './shared'

const META_ROBOTS_VALUES = new Set(['index,follow', 'noindex,follow', 'noindex,nofollow', 'index,nofollow'])

// Per-page SEO + event columns. Only keys actually present in the backup are returned, so
// restoring an older backup (made before these were exported) never blanks out values an
// overwrite target already has. A robots value outside the editor's four options is
// dropped rather than written — a backup file is user-editable.
function extraItemFields(item: NuxFlowBackup['content'][number]) {
  const out: Partial<typeof contentItems.$inferInsert> = {}
  if (item.canonicalUrl !== undefined) out.canonicalUrl = item.canonicalUrl
  if (item.metaRobots !== undefined) out.metaRobots = item.metaRobots && META_ROBOTS_VALUES.has(item.metaRobots) ? item.metaRobots : null
  if (item.focusKeyword !== undefined) out.focusKeyword = item.focusKeyword
  if (item.allowComments !== undefined) out.allowComments = item.allowComments
  if (item.eventStartAt !== undefined) out.eventStartAt = item.eventStartAt
  if (item.eventEndAt !== undefined) out.eventEndAt = item.eventEndAt
  if (item.eventAllDay !== undefined) out.eventAllDay = item.eventAllDay
  if (item.eventLocation !== undefined) out.eventLocation = item.eventLocation
  if (item.eventUrl !== undefined) out.eventUrl = item.eventUrl
  if (item.eventRsvpEnabled !== undefined) out.eventRsvpEnabled = item.eventRsvpEnabled
  if (item.eventRsvpCapacity !== undefined) out.eventRsvpCapacity = item.eventRsvpCapacity
  if (item.eventRsvpClosesAt !== undefined) out.eventRsvpClosesAt = item.eventRsvpClosesAt
  if (item.eventRecurrence !== undefined) out.eventRecurrence = item.eventRecurrence
  if (item.eventPrice !== undefined) out.eventPrice = item.eventPrice
  if (item.eventCurrency !== undefined) out.eventCurrency = item.eventCurrency
  if (item.eventCancelHours !== undefined) out.eventCancelHours = item.eventCancelHours
  if (item.eventPassesAllowed !== undefined) out.eventPassesAllowed = item.eventPassesAllowed
  if (item.fields !== undefined) out.fields = item.fields
  return out
}

// Replaces a content item's taxonomy-term assignments with the ones from the backup.
// Used for both freshly-inserted items and 'overwrite'-mode updates — the delete is a
// no-op for a brand-new id, but is what makes overwrite actually reapply the backup's
// termSlugs instead of leaving whatever assignments (or lack of them) already existed.
async function replaceContentTerms(
  db: Db,
  itemId: string,
  termSlugs: string[] | undefined,
  termIdBySlugPath: Map<string, string>,
): Promise<void> {
  await db.delete(contentTaxonomyTerms).where(eq(contentTaxonomyTerms.contentItemId, itemId))
  if (!termSlugs?.length) return
  // De-duplicated: a hand-edited backup listing the same term twice would otherwise hit
  // the (item, term) unique index and abort the whole restore.
  const termIds = [...new Set(termSlugs
    .map(s => termIdBySlugPath.get(s))
    .filter((t): t is string => t !== undefined))]
  if (termIds.length > 0) {
    await db.insert(contentTaxonomyTerms).values(termIds.map(termId => ({ contentItemId: itemId, termId })))
  }
}

/** An item restoreContent() wrote: `created` = a new row (new id), else overwritten in place. */
export interface WrittenItem { id: string; created: boolean }

/**
 * Restores content types and items. Returns the ids of the items it created or overwrote,
 * by slug — the ones whose products, calendars and links (restore-item-extras.ts) follow
 * the backup. Skipped items keep everything they had.
 */
export async function restoreContent(
  db: Db,
  siteId: string,
  backup: NuxFlowBackup,
  opts: RestoreOptions,
  result: RestoreResult,
  termIdBySlugPath: Map<string, string>,
): Promise<Map<string, WrittenItem>> {
  const written = new Map<string, WrittenItem>()
  if (!opts.what.includes('content') || !backup.content) return written

  // Build type slug -> id map
  const typeIdBySlug = new Map<string, string>()
  const ctRows = await db.query.contentTypes.findMany({ where: eq(contentTypes.siteId, siteId) })
  for (const t of ctRows) typeIdBySlug.set(t.slug, t.id)

  // Create any non-built-in content types from backup, with their custom fields. A type that
  // already exists here gets the backup's fields only if it has none of its own.
  for (const backupType of backup.contentTypes ?? []) {
    const fields = parseFieldDefs({ fields: backupType.fields })
    const existingType = ctRows.find(t => t.slug === backupType.slug)
    if (!existingType) {
      const id = ulid()
      await db.insert(contentTypes).values({
        id, siteId,
        slug: backupType.slug, name: backupType.name, singularName: backupType.singularName,
        icon: backupType.icon, isBuiltIn: false, hasRevisions: backupType.hasRevisions,
        hasComments: backupType.hasComments,
        schema: { fields },
      })
      typeIdBySlug.set(backupType.slug, id)
    }
    else if (fields.length && !parseFieldDefs(existingType.schema).length) {
      await db.update(contentTypes).set({ schema: { ...(existingType.schema ?? {}), fields } })
        .where(and(eq(contentTypes.id, existingType.id), eq(contentTypes.siteId, siteId)))
    }
  }

  const idBySlug = new Map<string, string>()

  // One prefetch instead of one findFirst() per backup item, which for a large backup
  // would be thousands of sequential round trips before the first write.
  const existingBySlug = new Map<string, { id: string; title: string }>()
  if (backup.content.length > 0) {
    const existingItems = await db.query.contentItems.findMany({
      where: and(eq(contentItems.siteId, siteId), inArray(contentItems.slug, backup.content.map(i => i.slug))),
      columns: { id: true, title: true, slug: true },
    })
    for (const item of existingItems) existingBySlug.set(item.slug, { id: item.id, title: item.title })
  }

  for (const backupItem of backup.content) {
    const typeId = typeIdBySlug.get(backupItem.typeSlug)
    if (!typeId) continue

    const existing = existingBySlug.get(backupItem.slug)

    if (existing) {
      idBySlug.set(backupItem.slug, existing.id)

      if (opts.conflictMode === 'archive') {
        // Smart Archiving: Rename existing conflicting page slug & title, mark as draft
        const timestamp = archiveSuffix()
        const slug = await freeArchiveSlug(`${backupItem.slug}-backup-${timestamp}`, async s => !!(await db.query.contentItems.findFirst({
          where: and(eq(contentItems.siteId, siteId), eq(contentItems.slug, s)),
          columns: { id: true },
        })))
        await db.update(contentItems).set({
          slug,
          title: `${existing.title} (Backup — ${timestamp})`,
          status: 'draft',
        }).where(and(eq(contentItems.id, existing.id), eq(contentItems.siteId, siteId)))
        // Proceed to insert the new page cleanly!
      } else if (opts.conflictMode === 'overwrite') {
        await db.update(contentItems).set({
          title: backupItem.title,
          status: backupItem.status as 'draft' | 'published' | 'scheduled' | 'archived' | 'review',
          // 'password' is a password-protected page (its hash travels in settings, so the
          // same password works after restore). Anything unknown falls back to 'members'.
          visibility: (backupItem.visibility === 'public' || backupItem.visibility === 'private' || backupItem.visibility === 'members' || backupItem.visibility === 'password')
            ? backupItem.visibility
            : 'members',
          content: backupItem.content,
          excerpt: backupItem.excerpt,
          seoTitle: backupItem.seoTitle,
          seoDescription: backupItem.seoDescription,
          ogImage: backupItem.ogImage,
          publishedAt: backupItem.publishedAt,
          settings: backupItem.settings ?? undefined,
          locale: backupItem.locale || 'en',
          ...extraItemFields(backupItem),
        }).where(and(eq(contentItems.id, existing.id), eq(contentItems.siteId, siteId)))
        // Reapply the backup's term assignments too — without this, overwriting an
        // existing item would update its fields but silently keep whatever
        // categories/tags it already had (or lacked), ignoring backupItem.termSlugs.
        await replaceContentTerms(db, existing.id, backupItem.termSlugs, termIdBySlugPath)
        written.set(backupItem.slug, { id: existing.id, created: false })
        result.content.updated++
        continue
      } else {
        result.content.skipped++
        continue
      }
    }

    if (!(await checkPlanLimit(db, siteId, 'content')).allowed) {
      noteLimit(result, 'content')
      result.content.skipped++
      continue
    }
    const id = ulid()
    idBySlug.set(backupItem.slug, id)
    await db.insert(contentItems).values({
      id, siteId, typeId,
      authorId: opts.authorId ?? null,
      slug: backupItem.slug,
      title: backupItem.title,
      status: backupItem.status as 'draft' | 'published' | 'scheduled' | 'archived' | 'review',
      visibility: (backupItem.visibility === 'public' || backupItem.visibility === 'private' || backupItem.visibility === 'members' || backupItem.visibility === 'password')
        ? backupItem.visibility
        : 'members',
      content: backupItem.content,
      excerpt: backupItem.excerpt,
      seoTitle: backupItem.seoTitle,
      seoDescription: backupItem.seoDescription,
      ogImage: backupItem.ogImage,
      publishedAt: backupItem.publishedAt,
      settings: backupItem.settings ?? undefined,
      locale: backupItem.locale || 'en',
      ...extraItemFields(backupItem),
    })

    await replaceContentTerms(db, id, backupItem.termSlugs, termIdBySlugPath)
    written.set(backupItem.slug, { id, created: true })

    result.content.created++
  }

  // Second pass: wire translation linkages
  for (const backupItem of backup.content) {
    if (backupItem.sourceItemSlug) {
      const childId = idBySlug.get(backupItem.slug)
      const parentId = idBySlug.get(backupItem.sourceItemSlug)
      if (childId && parentId) {
        await db.update(contentItems)
          .set({ sourceItemId: parentId })
          .where(and(eq(contentItems.id, childId), eq(contentItems.siteId, siteId)))
      }
    }
  }
  return written
}
