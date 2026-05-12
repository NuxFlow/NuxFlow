import { useDb } from '../../../../utils/db'
import { requireAuth } from '../../../../utils/permissions'
import { taxonomies, taxonomyTerms } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const taxonomyId = getRouterParam(event, 'id')!

  const taxonomy = await db.query.taxonomies.findFirst({
    where: and(eq(taxonomies.id, taxonomyId), eq(taxonomies.siteId, siteId)),
  })
  if (!taxonomy) throw createError({ statusCode: 404, message: 'Taxonomy not found' })

  const terms = await db.query.taxonomyTerms.findMany({
    where: eq(taxonomyTerms.taxonomyId, taxonomyId),
    columns: { id: true, slug: true, name: true, description: true, parentId: true, createdAt: true },
  })

  return { terms }
})
