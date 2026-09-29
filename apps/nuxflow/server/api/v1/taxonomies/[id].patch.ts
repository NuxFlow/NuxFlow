import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { getTaxonomyByIdOrThrow } from '../../../utils/resource-queries'
import { redirectMovedPaths } from '../../../utils/redirects'
import {
  assertTaxonomySlugAvailable, getTaxonomyContentTypeSlugs, purgeTaxonomyCache, setTaxonomyContentTypesStatements, termArchivePath,
} from '../../../utils/taxonomy'
import { taxonomies, taxonomyTerms } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { scopedById } from '../../../utils/db-helpers'
import type { BatchItem } from 'drizzle-orm/batch'

const bodySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  slug: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(500).nullish(),
  isHierarchical: z.boolean().optional(),
  noindex: z.boolean().optional(),
  // Content type slugs this taxonomy applies to; [] = every type.
  contentTypes: z.array(z.string().min(1).max(100)).max(50).optional(),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const body = await parseBody(event, bodySchema)

  const existing = await getTaxonomyByIdOrThrow(db, siteId, id)

  const slugChanged = body.slug !== undefined && body.slug !== existing.slug
  if (slugChanged) await assertTaxonomySlugAvailable(db, siteId, body.slug!, id)

  const { contentTypes: typeSlugs, description, ...fields } = body
  const columnUpdate = { ...fields, ...(description !== undefined ? { description: description || null } : {}) }
  const writes: BatchItem<'sqlite'>[] = []
  // A PATCH that only changes the content-type scope has no column to set.
  if (Object.values(columnUpdate).some(v => v !== undefined)) {
    writes.push(db.update(taxonomies).set(columnUpdate).where(scopedById(taxonomies.id, id, taxonomies.siteId, siteId)))
  }
  // Turning hierarchy off flattens the tree — otherwise the stored parent links would
  // keep silently widening parent archives nobody can see or edit anymore.
  if (existing.isHierarchical && body.isHierarchical === false) {
    writes.push(db.update(taxonomyTerms).set({ parentId: null }).where(eq(taxonomyTerms.taxonomyId, id)))
  }
  if (typeSlugs !== undefined) writes.push(...await setTaxonomyContentTypesStatements(db, siteId, id, typeSlugs))

  if (writes.length === 0) return { id }

  const beforeTypes = (await getTaxonomyContentTypeSlugs(db, [id])).get(id) ?? []
  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'update',
    resource: 'taxonomy',
    resourceId: id,
    before: { ...existing, contentTypes: beforeTypes },
    after: body,
  })

  await batchWithAudit(db, writes, auditInsert)

  const terms = await db.select({ id: taxonomyTerms.id, slug: taxonomyTerms.slug })
    .from(taxonomyTerms)
    .where(eq(taxonomyTerms.taxonomyId, id))

  // A renamed taxonomy moves every archive URL under it — 301 the old ones.
  if (slugChanged) {
    await redirectMovedPaths(db, siteId, [
      { from: `/${existing.slug}`, to: `/${body.slug}` },
      ...terms.map(t => ({ from: termArchivePath(existing.slug, t.slug), to: termArchivePath(body.slug!, t.slug) })),
    ])
  }

  const slugs = slugChanged ? [existing.slug, body.slug!] : [existing.slug]
  await purgeTaxonomyCache(event, db, {
    taxonomySlugs: slugs,
    terms: slugs.flatMap(s => terms.map(t => ({ taxonomySlug: s, termSlug: t.slug }))),
    // The taxonomy name/slug shows in every tagged page's term links.
    itemsOfTermIds: terms.map(t => t.id),
  })

  return { id }
})
