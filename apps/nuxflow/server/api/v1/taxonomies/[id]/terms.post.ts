import { z } from 'zod'
import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../../utils/audit'
import { getTaxonomyByIdOrThrow } from '../../../../utils/resource-queries'
import { created } from '../../../../utils/response'
import { TAXONOMY_SLUG_RE, assertValidTermParent, slugify } from '../../../../utils/taxonomy'
import { taxonomyTerms } from '@nuxflow/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { ulid } from 'ulid'

const bodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  // Derived from the name when omitted.
  slug: z.string().trim().max(200).optional(),
  description: z.string().max(500).nullish(),
  parentId: z.string().nullish(),
  sortOrder: z.number().int().min(-100000).max(100000).optional(),
  seoTitle: z.string().max(200).nullish(),
  seoDescription: z.string().max(500).nullish(),
  ogImage: z.string().max(2048).nullish(),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const taxonomyId = getRouterParam(event, 'id')!
  const body = await parseBody(event, bodySchema)

  const taxonomy = await getTaxonomyByIdOrThrow(db, siteId, taxonomyId)

  const slug = body.slug || slugify(body.name)
  if (!slug) validationError('Enter a slug — the name has no letters or digits to build one from')
  if (!TAXONOMY_SLUG_RE.test(slug)) validationError('Slugs may only contain lowercase letters, digits, and single dashes')

  const slugConflict = await db.query.taxonomyTerms.findFirst({
    where: and(eq(taxonomyTerms.taxonomyId, taxonomyId), eq(taxonomyTerms.slug, slug)),
    columns: { id: true },
  })
  if (slugConflict) conflict(`A term with the slug "${slug}" already exists in this taxonomy`)

  // parentId has no DB-level FK (taxonomyTerms.parentId is deliberately a plain column —
  // see CLAUDE.md/schema comment on why a self-referencing FK here risks silent data loss
  // on a future migration), so the parent's existence, taxonomy, and the taxonomy being
  // hierarchical at all are all checked here.
  if (body.parentId) await assertValidTermParent(db, taxonomy, null, body.parentId)

  // New terms go to the end of their taxonomy's manual order unless one is given.
  let sortOrder = body.sortOrder
  if (sortOrder === undefined) {
    const [row] = await db.select({ max: sql<number | null>`max(${taxonomyTerms.sortOrder})` })
      .from(taxonomyTerms)
      .where(eq(taxonomyTerms.taxonomyId, taxonomyId))
    sortOrder = row?.max === null || row?.max === undefined ? 0 : Number(row.max) + 1
  }

  const id = ulid()
  const values = {
    id,
    taxonomyId,
    slug,
    name: body.name,
    description: body.description || null,
    parentId: body.parentId || null,
    sortOrder,
    seoTitle: body.seoTitle || null,
    seoDescription: body.seoDescription || null,
    ogImage: body.ogImage || null,
  }

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'create',
    resource: 'taxonomy_term',
    resourceId: id,
    after: values,
  })

  await batchWithAudit(db, [db.insert(taxonomyTerms).values(values)], auditInsert)

  return created(event, { id, slug })
})
