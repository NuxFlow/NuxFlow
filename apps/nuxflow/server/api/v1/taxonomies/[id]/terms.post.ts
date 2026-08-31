import { z } from 'zod'
import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../../utils/audit'
import { getTaxonomyByIdOrThrow } from '../../../../utils/resource-queries'
import { created } from '../../../../utils/response'
import { taxonomyTerms } from '@nuxflow/db/schema'
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

  await getTaxonomyByIdOrThrow(db, siteId, taxonomyId)

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

  await batchWithAudit(db, [termInsert], auditInsert)

  return created(event, { id })
})
