import { z } from 'zod'
import { useDb } from '../../../../../utils/db'
import { requireRole } from '../../../../../utils/permissions'
import { taxonomies, taxonomyTerms } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

const bodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  parentId: z.string().nullish(),
})

export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const taxonomyId = getRouterParam(event, 'id')!
  const termId = getRouterParam(event, 'termId')!
  const body = await readValidatedBody(event, bodySchema.parse)

  const taxonomy = await db.query.taxonomies.findFirst({
    where: and(eq(taxonomies.id, taxonomyId), eq(taxonomies.siteId, siteId)),
  })
  if (!taxonomy) throw createError({ statusCode: 404, message: 'Taxonomy not found' })

  const term = await db.query.taxonomyTerms.findFirst({
    where: and(eq(taxonomyTerms.id, termId), eq(taxonomyTerms.taxonomyId, taxonomyId)),
  })
  if (!term) throw createError({ statusCode: 404, message: 'Term not found' })

  await db.update(taxonomyTerms).set(body).where(eq(taxonomyTerms.id, termId))

  return { id: termId }
})
