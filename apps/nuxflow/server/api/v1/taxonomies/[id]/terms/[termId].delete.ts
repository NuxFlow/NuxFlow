import { useDb } from '../../../../../utils/db'
import { requireRole } from '../../../../../utils/permissions'
import { taxonomies, taxonomyTerms } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const taxonomyId = getRouterParam(event, 'id')!
  const termId = getRouterParam(event, 'termId')!

  const taxonomy = await db.query.taxonomies.findFirst({
    where: and(eq(taxonomies.id, taxonomyId), eq(taxonomies.siteId, siteId)),
  })
  if (!taxonomy) throw createError({ statusCode: 404, message: 'Taxonomy not found' })

  await db.delete(taxonomyTerms).where(and(eq(taxonomyTerms.id, termId), eq(taxonomyTerms.taxonomyId, taxonomyId)))

  return { success: true }
})
