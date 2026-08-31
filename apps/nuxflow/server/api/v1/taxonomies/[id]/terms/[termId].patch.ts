import { z } from 'zod'
import { useDb } from '../../../../../utils/db'
import { requireRole } from '../../../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../../../utils/audit'
import { getTaxonomyByIdOrThrow, getTaxonomyTermByIdOrThrow } from '../../../../../utils/resource-queries'
import { taxonomyTerms } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

const bodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  parentId: z.string().nullish(),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const taxonomyId = getRouterParam(event, 'id')!
  const termId = getRouterParam(event, 'termId')!
  const body = await parseBody(event, bodySchema)

  await getTaxonomyByIdOrThrow(db, siteId, taxonomyId)
  const term = await getTaxonomyTermByIdOrThrow(db, taxonomyId, termId)

  const termUpdate = db.update(taxonomyTerms).set(body).where(and(eq(taxonomyTerms.id, termId), eq(taxonomyTerms.taxonomyId, taxonomyId)))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'update',
    resource: 'taxonomy_term',
    resourceId: termId,
    before: term,
    after: body,
  })

  await batchWithAudit(db, [termUpdate], auditInsert)

  return { id: termId }
})
