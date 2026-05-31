import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { taxonomies } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

const bodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  isHierarchical: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const body = await readValidatedBody(event, bodySchema.parse)

  const existing = await db.query.taxonomies.findFirst({
    where: and(eq(taxonomies.id, id), eq(taxonomies.siteId, siteId)),
  })
  if (!existing) throw createError({ statusCode: 404, message: 'Taxonomy not found' })

  await db.update(taxonomies).set(body).where(and(eq(taxonomies.id, id), eq(taxonomies.siteId, siteId)))

  return { id }
})
