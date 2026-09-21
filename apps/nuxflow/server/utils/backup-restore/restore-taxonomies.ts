// ── Taxonomies + terms restore ────────────────────────────────────────────────
import { and, eq, inArray } from 'drizzle-orm'
import { taxonomies, taxonomyTerms } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import type { Db } from '../db'
import type { NuxFlowBackup, RestoreOptions, RestoreResult } from '../backup-types'

// Restores taxonomies + terms and returns a termSlugPath ("{taxSlug}/{termSlug}") -> termId
// map, which restore-content.ts needs to resolve BackupContentItem.termSlugs into real ids.
export async function restoreTaxonomies(
  db: Db,
  siteId: string,
  backup: NuxFlowBackup,
  opts: RestoreOptions,
  result: RestoreResult,
): Promise<Map<string, string>> {
  const termIdBySlugPath = new Map<string, string>()

  if (!opts.what.includes('taxonomies') || !backup.taxonomies) return termIdBySlugPath

  // One prefetch instead of one findFirst() per taxonomy — a backup with many
  // taxonomies previously meant one D1 round trip per taxonomy before any write.
  const taxSlugs = backup.taxonomies.map(t => t.slug)
  const existingTaxRows = taxSlugs.length > 0
    ? await db.query.taxonomies.findMany({
        where: and(eq(taxonomies.siteId, siteId), inArray(taxonomies.slug, taxSlugs)),
        columns: { id: true, slug: true },
      })
    : []
  const taxIdBySlug = new Map(existingTaxRows.map(t => [t.slug, t.id]))

  // Same for terms: one prefetch across every taxonomy that already exists, keyed by
  // "{taxonomyId}/{slug}" since a term's slug is only unique within its own taxonomy.
  // A taxonomy created fresh below can't have any pre-existing terms, so it needs no
  // entry here.
  const existingTaxIds = existingTaxRows.map(t => t.id)
  const existingTermRows = existingTaxIds.length > 0
    ? await db.query.taxonomyTerms.findMany({
        where: inArray(taxonomyTerms.taxonomyId, existingTaxIds),
        columns: { id: true, taxonomyId: true, slug: true },
      })
    : []
  const termIdByTaxAndSlug = new Map(existingTermRows.map(t => [`${t.taxonomyId}/${t.slug}`, t.id]))

  for (const backupTax of backup.taxonomies) {
    let taxId = taxIdBySlug.get(backupTax.slug)
    if (!taxId) {
      taxId = ulid()
      await db.insert(taxonomies).values({
        id: taxId, siteId, slug: backupTax.slug, name: backupTax.name, isHierarchical: backupTax.isHierarchical,
      })
      result.taxonomies.created++
      // A backup.json is user-editable and could (however unrealistically) contain a
      // duplicate taxonomy slug; recording the freshly-created id here means a second
      // entry for the same slug is treated as already-existing instead of attempting a
      // second insert with the same (siteId, slug).
      taxIdBySlug.set(backupTax.slug, taxId)
    } else if (opts.conflictMode === 'overwrite') {
      // Every other restorable section honors 'overwrite' by updating the existing
      // row's data — taxonomies/terms previously only ever recorded the existing id
      // for term/content-assignment purposes and never touched name/description/
      // isHierarchical, silently keeping stale target-site values even in this mode.
      await db.update(taxonomies)
        .set({ name: backupTax.name, isHierarchical: backupTax.isHierarchical })
        .where(eq(taxonomies.id, taxId))
    }

    // Insert terms (two-pass for parent references)
    const termIdBySlug = new Map<string, string>()
    const newlyCreatedTermIds = new Set<string>()

    for (const backupTerm of backupTax.terms) {
      const key = `${taxId}/${backupTerm.slug}`
      let termId = termIdByTaxAndSlug.get(key)
      if (!termId) {
        termId = ulid()
        await db.insert(taxonomyTerms).values({
          id: termId,
          taxonomyId: taxId,
          slug: backupTerm.slug,
          name: backupTerm.name,
          description: backupTerm.description,
          parentId: null, // set in second pass
        })
        result.terms.created++
        termIdByTaxAndSlug.set(key, termId)
        newlyCreatedTermIds.add(termId)
      } else if (opts.conflictMode === 'overwrite') {
        await db.update(taxonomyTerms)
          .set({ name: backupTerm.name, description: backupTerm.description })
          .where(eq(taxonomyTerms.id, termId))
      }
      termIdBySlug.set(backupTerm.slug, termId)
      termIdBySlugPath.set(`${backupTax.slug}/${backupTerm.slug}`, termId)
    }

    // Second pass: wire parent IDs. Only for terms this call actually created or is
    // overwriting — a pre-existing term being skipped shouldn't have its parent
    // silently reassigned just because its slug happened to also appear in the backup.
    for (const backupTerm of backupTax.terms) {
      if (backupTerm.parentSlug) {
        const childId = termIdBySlug.get(backupTerm.slug)
        const parentId = termIdBySlug.get(backupTerm.parentSlug)
        if (childId && parentId && (newlyCreatedTermIds.has(childId) || opts.conflictMode === 'overwrite')) {
          await db.update(taxonomyTerms).set({ parentId }).where(eq(taxonomyTerms.id, childId))
        }
      }
    }
  }

  return termIdBySlugPath
}
