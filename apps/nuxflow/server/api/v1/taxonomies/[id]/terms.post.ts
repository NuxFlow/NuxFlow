import { z } from 'zod'
import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { buildAuditLogInsert } from '../../../../utils/audit'
import { taxonomies, taxonomyTerms } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'

const bodySchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(200).regex(/^[a-z0-9-]+$/),
  description: z.string().max(500).optional(),
  parentId: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const taxonomyId = getRouterParam(event, 'id')!
  const body = await parseBody(event, bodySchema)

  const taxonomy = await db.query.taxonomies.findFirst({
    where: and(eq(taxonomies.id, taxonomyId), eq(taxonomies.siteId, siteId)),
  })
  if (!taxonomy) throw notFound('Taxonomy not found')

  const id = ulid()
  const termInsert = db.insert(taxonomyTerms).values({
    id,
    taxonomyId,
    slug: body.slug,
    name: body.name,
    description: body.description ?? null,
    parentId: body.parentId ?? null,
  })

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'create',
    resource: 'taxonomy_term',
    resourceId: id,
    after: body,
  })

  await db.batch(auditInsert ? [termInsert, auditInsert] : [termInsert])

  setResponseStatus(event, 201)
  return { id }
})
