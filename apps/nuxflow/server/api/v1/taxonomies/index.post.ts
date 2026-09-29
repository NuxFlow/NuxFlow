import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { created } from '../../../utils/response'
import { assertTaxonomySlugAvailable, purgeTaxonomyCache, setTaxonomyContentTypesStatements, slugify } from '../../../utils/taxonomy'
import { taxonomies } from '@nuxflow/db/schema'
import { ulid } from 'ulid'

const bodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  // Derived from the name when omitted.
  slug: z.string().trim().max(100).optional(),
  description: z.string().max(500).nullish(),
  isHierarchical: z.boolean().default(false),
  noindex: z.boolean().default(false),
  // Content type slugs this taxonomy applies to; empty/omitted = every type.
  contentTypes: z.array(z.string().min(1).max(100)).max(50).default([]),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const body = await parseBody(event, bodySchema)

  const slug = body.slug || slugify(body.name)
  if (!slug) validationError('Enter a slug — the name has no letters or digits to build one from')
  await assertTaxonomySlugAvailable(db, siteId, slug)

  const id = ulid()
  const values = {
    id, siteId, slug, name: body.name, description: body.description || null, isHierarchical: body.isHierarchical, noindex: body.noindex,
  }
  const typeWrites = await setTaxonomyContentTypesStatements(db, siteId, id, body.contentTypes)

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'create',
    resource: 'taxonomy',
    resourceId: id,
    after: { ...values, contentTypes: body.contentTypes },
  })

  // The taxonomy row must exist before its content-type links (FK), so it goes first.
  await batchWithAudit(db, [db.insert(taxonomies).values(values), ...typeWrites.slice(1)], auditInsert)
  await purgeTaxonomyCache(event, db, { taxonomySlugs: [slug] })

  return created(event, { id, slug })
})
