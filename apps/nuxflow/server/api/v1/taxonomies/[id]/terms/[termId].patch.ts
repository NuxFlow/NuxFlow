import { z } from 'zod'
import { useDb } from '../../../../../utils/db'
import { requireRole } from '../../../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../../../utils/audit'
import { getTaxonomyByIdOrThrow, getTaxonomyTermByIdOrThrow } from '../../../../../utils/resource-queries'
import { redirectMovedPaths } from '../../../../../utils/redirects'
import {
  TAXONOMY_SLUG_RE, assertValidTermParent, getTermRefsWithAncestors, getTermWithDescendantIds, purgeTaxonomyCache, termArchivePath,
} from '../../../../../utils/taxonomy'
import { taxonomyTerms } from '@nuxflow/db/schema'
import { and, eq, ne } from 'drizzle-orm'

const bodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  slug: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(500).nullish(),
  parentId: z.string().nullish(),
  sortOrder: z.number().int().min(-100000).max(100000).optional(),
  seoTitle: z.string().max(200).nullish(),
  seoDescription: z.string().max(500).nullish(),
  ogImage: z.string().max(2048).nullish(),
})

// Optional text fields: undefined leaves the column alone, ''/null clears it.
const NULLABLE_TEXT = ['description', 'seoTitle', 'seoDescription', 'ogImage'] as const

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const taxonomyId = getRouterParam(event, 'id')!
  const termId = getRouterParam(event, 'termId')!
  const body = await parseBody(event, bodySchema)

  const taxonomy = await getTaxonomyByIdOrThrow(db, siteId, taxonomyId)
  const term = await getTaxonomyTermByIdOrThrow(db, taxonomyId, termId)

  const slugChanged = body.slug !== undefined && body.slug !== term.slug
  if (slugChanged) {
    if (!TAXONOMY_SLUG_RE.test(body.slug!)) validationError('Slugs may only contain lowercase letters, digits, and single dashes')
    const clash = await db.query.taxonomyTerms.findFirst({
      where: and(eq(taxonomyTerms.taxonomyId, taxonomyId), eq(taxonomyTerms.slug, body.slug!), ne(taxonomyTerms.id, termId)),
      columns: { id: true },
    })
    if (clash) conflict(`A term with the slug "${body.slug}" already exists in this taxonomy`)
  }

  // parentId has no DB-level FK (see the schema comment), so existence, same-taxonomy,
  // hierarchical-only, and "not itself or one of its own descendants" are all enforced
  // here — a cycle would make every parent-chain walk (breadcrumbs, archive roll-ups) loop.
  if (body.parentId) await assertValidTermParent(db, taxonomy, termId, body.parentId)

  const update: Partial<typeof taxonomyTerms.$inferInsert> = {}
  if (body.name !== undefined) update.name = body.name
  if (body.slug !== undefined) update.slug = body.slug
  if (body.sortOrder !== undefined) update.sortOrder = body.sortOrder
  if (body.parentId !== undefined) update.parentId = body.parentId || null
  for (const key of NULLABLE_TEXT) {
    if (body[key] !== undefined) update[key] = body[key] || null
  }
  if (Object.keys(update).length === 0) return { id: termId }

  // Archive refs before the change: the old slug's archive and the old parent chain both
  // need purging, alongside the new ones.
  const affectedIds = await getTermWithDescendantIds(db, taxonomyId, termId)
  const beforeRefs = await getTermRefsWithAncestors(db, [termId])

  const termUpdate = db.update(taxonomyTerms).set(update).where(and(eq(taxonomyTerms.id, termId), eq(taxonomyTerms.taxonomyId, taxonomyId)))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'update',
    resource: 'taxonomy_term',
    resourceId: termId,
    before: term,
    after: update,
  })

  await batchWithAudit(db, [termUpdate], auditInsert)

  if (slugChanged) {
    await redirectMovedPaths(db, siteId, [{ from: termArchivePath(taxonomy.slug, term.slug), to: termArchivePath(taxonomy.slug, body.slug!) }])
  }

  const afterRefs = await getTermRefsWithAncestors(db, [termId])
  await purgeTaxonomyCache(event, db, {
    taxonomySlugs: [taxonomy.slug],
    terms: [...beforeRefs, ...afterRefs],
    // Name/slug show in the term links on every tagged page (and sub-terms' pages, whose
    // breadcrumbs name this term).
    itemsOfTermIds: body.name !== undefined || slugChanged ? affectedIds : [],
  })

  return { id: termId }
})
