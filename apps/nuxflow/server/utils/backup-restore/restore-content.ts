// ── Content types + content items restore ─────────────────────────────────────
import { and, eq, inArray } from 'drizzle-orm'
import { contentTypes, contentItems, contentTaxonomyTerms } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import type { Db } from '../db'
import type { NuxFlowBackup, RestoreOptions, RestoreResult } from '../backup-types'
import { archiveSuffix } from './shared'

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
  const termIds = termSlugs
    .map(s => termIdBySlugPath.get(s))
    .filter((t): t is string => t !== undefined)
  if (termIds.length > 0) {
    await db.insert(contentTaxonomyTerms).values(termIds.map(termId => ({ contentItemId: itemId, termId })))
  }
}

export async function restoreContent(
  db: Db,
  siteId: string,
  backup: NuxFlowBackup,
  opts: RestoreOptions,
  result: RestoreResult,
  termIdBySlugPath: Map<string, string>,
): Promise<void> {
  if (!opts.what.includes('content') || !backup.content) return

  // Build type slug -> id map
  const typeIdBySlug = new Map<string, string>()
  const ctRows = await db.query.contentTypes.findMany({ where: eq(contentTypes.siteId, siteId) })
  for (const t of ctRows) typeIdBySlug.set(t.slug, t.id)

  // Create any non-built-in content types from backup
  for (const backupType of backup.contentTypes ?? []) {
    if (!typeIdBySlug.has(backupType.slug)) {
      const id = ulid()
      await db.insert(contentTypes).values({
        id, siteId,
        slug: backupType.slug, name: backupType.name, singularName: backupType.singularName,
        icon: backupType.icon, isBuiltIn: false, hasRevisions: backupType.hasRevisions,
        hasComments: backupType.hasComments,
      })
      typeIdBySlug.set(backupType.slug, id)
    }
  }

  const idBySlug = new Map<string, string>()

  // One prefetch instead of one findFirst() per backup item — a backup with a few
  // thousand items previously meant a few thousand sequential existence-check round
  // trips before any write even happened.
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
        await db.update(contentItems).set({
          slug: `${backupItem.slug}-backup-${timestamp}`,
          title: `${existing.title} (Backup — ${timestamp})`,
          status: 'draft',
        }).where(eq(contentItems.id, existing.id))
        // Proceed to insert the new page cleanly!
      } else if (opts.conflictMode === 'overwrite') {
        await db.update(contentItems).set({
          title: backupItem.title,
          status: backupItem.status as 'draft' | 'published' | 'scheduled' | 'archived' | 'review',
          // A pre-existing backup could in principle carry the now-removed 'password'
          // value (it was a legal enum member, even though nothing ever actually wrote
          // it) — fall back to 'members' rather than let an invalid literal through.
          visibility: (backupItem.visibility === 'public' || backupItem.visibility === 'private' || backupItem.visibility === 'members')
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
        }).where(eq(contentItems.id, existing.id))
        // Reapply the backup's term assignments too — without this, overwriting an
        // existing item would update its fields but silently keep whatever
        // categories/tags it already had (or lacked), ignoring backupItem.termSlugs.
        await replaceContentTerms(db, existing.id, backupItem.termSlugs, termIdBySlugPath)
        result.content.updated++
        continue
      } else {
        result.content.skipped++
        continue
      }
    }

    const id = ulid()
    idBySlug.set(backupItem.slug, id)
    await db.insert(contentItems).values({
      id, siteId, typeId,
      slug: backupItem.slug,
      title: backupItem.title,
      status: backupItem.status as 'draft' | 'published' | 'scheduled' | 'archived' | 'review',
      visibility: (backupItem.visibility === 'public' || backupItem.visibility === 'private' || backupItem.visibility === 'members')
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
    })

    await replaceContentTerms(db, id, backupItem.termSlugs, termIdBySlugPath)

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
          .where(eq(contentItems.id, childId))
      }
    }
  }
}
