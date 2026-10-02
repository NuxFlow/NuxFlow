// ── Taxonomies + terms restore ────────────────────────────────────────────────
import { and, eq, inArray } from 'drizzle-orm'
import { contentTypes, taxonomies, taxonomyContentTypes, taxonomyTerms } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import type { Db } from '../db'
import type { BackupTerm, NuxFlowBackup, RestoreOptions, RestoreResult } from '../backup-types'

/**
 * parentSlug links from a (user-editable) backup that would form a cycle are dropped —
 * parentId has no DB-level FK or cycle check, and a loop would hang every parent-chain
 * walk (breadcrumbs, archive roll-ups). Only the links of terms that are themselves on a
 * cycle are dropped; a term merely nested under one (c → b with a ↔ b) keeps its parent,
 * which is valid once the cycle's own links are gone. Links to a missing parent go too.
 */
function acyclicParentSlugs(terms: BackupTerm[]): Map<string, string | null> {
  const parentOf = new Map(terms.map(t => [t.slug, t.parentSlug]))
  const out = new Map<string, string | null>()
  for (const t of terms) {
    if (!t.parentSlug || !parentOf.has(t.parentSlug)) {
      out.set(t.slug, null)
      continue
    }
    let onCycle = false
    const seen = new Set<string>()
    let cursor: string | null | undefined = t.parentSlug
    while (cursor && !seen.has(cursor)) {
      if (cursor === t.slug) {
        onCycle = true
        break
      }
      seen.add(cursor)
      cursor = parentOf.get(cursor)
    }
    out.set(t.slug, onCycle ? null : t.parentSlug)
  }
  return out
}

// Restores taxonomies + terms and returns a termSlugPath ("{taxSlug}/{termSlug}") -> termId
// map, which restore-content.ts needs to resolve BackupContentItem.termSlugs into real ids.
// When taxonomies aren't part of this restore, the map is built from the site's existing
// terms instead, so restored content still gets whichever of its terms already exist
// (rather than an overwrite silently stripping every assignment).
export async function restoreTaxonomies(
  db: Db,
  siteId: string,
  backup: NuxFlowBackup,
  opts: RestoreOptions,
  result: RestoreResult,
): Promise<Map<string, string>> {
  const termIdBySlugPath = new Map<string, string>()

  if (!opts.what.includes('taxonomies') || !backup.taxonomies) {
    const existing = await db.select({ id: taxonomyTerms.id, termSlug: taxonomyTerms.slug, taxSlug: taxonomies.slug })
      .from(taxonomyTerms)
      .innerJoin(taxonomies, eq(taxonomies.id, taxonomyTerms.taxonomyId))
      .where(eq(taxonomies.siteId, siteId))
    for (const t of existing) termIdBySlugPath.set(`${t.taxSlug}/${t.termSlug}`, t.id)
    return termIdBySlugPath
  }

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
    const taxSlug = backupTax.slug
    let taxId = taxIdBySlug.get(taxSlug)
    if (!taxId) {
      taxId = ulid()
      await db.insert(taxonomies).values({
        id: taxId,
        siteId,
        slug: taxSlug,
        name: backupTax.name,
        description: backupTax.description ?? null,
        isHierarchical: backupTax.isHierarchical,
        noindex: backupTax.noindex ?? false,
      })
      result.taxonomies.created++
      // A backup.json is user-editable and could (however unrealistically) contain a
      // duplicate taxonomy slug; recording the freshly-created id here means a second
      // entry for the same slug is treated as already-existing instead of attempting a
      // second insert with the same (siteId, slug).
      taxIdBySlug.set(taxSlug, taxId)
    } else if (opts.conflictMode === 'overwrite') {
      // Every other restorable section honors 'overwrite' by updating the existing
      // row's data — including the fields older backups don't carry only when present.
      await db.update(taxonomies)
        .set({
          name: backupTax.name,
          isHierarchical: backupTax.isHierarchical,
          ...(backupTax.description !== undefined ? { description: backupTax.description } : {}),
          ...(backupTax.noindex !== undefined ? { noindex: backupTax.noindex } : {}),
        })
        .where(eq(taxonomies.id, taxId))
    }

    // Insert terms (two-pass for parent references)
    const termIdBySlug = new Map<string, string>()
    const newlyCreatedTermIds = new Set<string>()

    for (const backupTerm of backupTax.terms) {
      const key = `${taxId}/${backupTerm.slug}`
      let termId = termIdByTaxAndSlug.get(key)
      const optional = {
        ...(backupTerm.sortOrder !== undefined ? { sortOrder: backupTerm.sortOrder } : {}),
        ...(backupTerm.seoTitle !== undefined ? { seoTitle: backupTerm.seoTitle } : {}),
        ...(backupTerm.seoDescription !== undefined ? { seoDescription: backupTerm.seoDescription } : {}),
        ...(backupTerm.ogImage !== undefined ? { ogImage: backupTerm.ogImage } : {}),
      }
      if (!termId) {
        termId = ulid()
        await db.insert(taxonomyTerms).values({
          id: termId,
          taxonomyId: taxId,
          slug: backupTerm.slug,
          name: backupTerm.name,
          description: backupTerm.description,
          parentId: null, // set in second pass
          ...optional,
        })
        result.terms.created++
        termIdByTaxAndSlug.set(key, termId)
        newlyCreatedTermIds.add(termId)
      } else if (opts.conflictMode === 'overwrite') {
        await db.update(taxonomyTerms)
          .set({ name: backupTerm.name, description: backupTerm.description, ...optional })
          .where(eq(taxonomyTerms.id, termId))
      }
      termIdBySlug.set(backupTerm.slug, termId)
      termIdBySlugPath.set(`${taxSlug}/${backupTerm.slug}`, termId)
    }

    // Second pass: wire parent IDs. Only for terms this call actually created or is
    // overwriting — a pre-existing term being skipped shouldn't have its parent
    // silently reassigned just because its slug happened to also appear in the backup.
    // A flat taxonomy never gets parents; cyclic links are dropped.
    const parentSlugs = backupTax.isHierarchical ? acyclicParentSlugs(backupTax.terms) : new Map<string, string | null>()
    for (const backupTerm of backupTax.terms) {
      const childId = termIdBySlug.get(backupTerm.slug)
      if (!childId || !(newlyCreatedTermIds.has(childId) || opts.conflictMode === 'overwrite')) continue
      const parentSlug = parentSlugs.get(backupTerm.slug) ?? null
      const parentId = parentSlug ? termIdBySlug.get(parentSlug) ?? null : null
      if (parentId || opts.conflictMode === 'overwrite') {
        await db.update(taxonomyTerms).set({ parentId }).where(eq(taxonomyTerms.id, childId))
      }
    }
  }

  return termIdBySlugPath
}

/**
 * Restores which content types each taxonomy applies to. Runs after content restore,
 * because that's where a backup's custom content types get created. Only touches a
 * taxonomy whose backup entry says anything about it (older backups don't).
 */
export async function restoreTaxonomyContentTypes(
  db: Db,
  siteId: string,
  backup: NuxFlowBackup,
  opts: RestoreOptions,
): Promise<void> {
  if (!opts.what.includes('taxonomies') || !backup.taxonomies) return
  const withTypes = backup.taxonomies.filter(t => t.contentTypes !== undefined)
  if (withTypes.length === 0) return

  const [taxRows, typeRows] = await Promise.all([
    db.query.taxonomies.findMany({ where: eq(taxonomies.siteId, siteId), columns: { id: true, slug: true } }),
    db.query.contentTypes.findMany({ where: eq(contentTypes.siteId, siteId), columns: { id: true, slug: true } }),
  ])
  const taxIdBySlug = new Map(taxRows.map(t => [t.slug, t.id]))
  const typeIdBySlug = new Map(typeRows.map(t => [t.slug, t.id]))

  for (const backupTax of withTypes) {
    const taxId = taxIdBySlug.get(backupTax.slug)
    if (!taxId) continue
    const existing = await db.query.taxonomyContentTypes.findFirst({
      where: eq(taxonomyContentTypes.taxonomyId, taxId),
    })
    // 'skip'/'archive' keep a scope the target site already set up.
    if (existing && opts.conflictMode !== 'overwrite') continue
    const typeIds = [...new Set((backupTax.contentTypes ?? []).map(s => typeIdBySlug.get(s)).filter((id): id is string => Boolean(id)))]
    await db.delete(taxonomyContentTypes).where(eq(taxonomyContentTypes.taxonomyId, taxId))
    if (typeIds.length) {
      await db.insert(taxonomyContentTypes).values(typeIds.map(contentTypeId => ({ taxonomyId: taxId, contentTypeId })))
    }
  }
}
