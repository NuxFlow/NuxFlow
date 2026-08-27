import { z } from 'zod'
import { useDb } from '../../../../../utils/db'
import { requireRole } from '../../../../../utils/permissions'
import { writeAuditLog } from '../../../../../utils/audit'
import { taxonomies, taxonomyTerms } from '@nuxflow/db/schema'
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

  const taxonomy = await db.query.taxonomies.findFirst({
    where: and(eq(taxonomies.id, taxonomyId), eq(taxonomies.siteId, siteId)),
  })
  if (!taxonomy) throw notFound('Taxonomy not found')

  const term = await db.query.taxonomyTerms.findFirst({
    where: and(eq(taxonomyTerms.id, termId), eq(taxonomyTerms.taxonomyId, taxonomyId)),
  })
  if (!term) throw notFound('Term not found')

  await db.update(taxonomyTerms).set(body).where(eq(taxonomyTerms.id, termId))

  await writeAuditLog(event, userId, {
    action: 'update',
    resource: 'taxonomy_term',
    resourceId: termId,
    before: term,
    after: body,
  })

  return { id: termId }
})
