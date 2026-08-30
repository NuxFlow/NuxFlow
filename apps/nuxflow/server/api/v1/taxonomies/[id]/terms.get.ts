import { useDb } from '../../../../utils/db'
import { requireAuth } from '../../../../utils/permissions'
import { getTaxonomyByIdOrThrow } from '../../../../utils/resource-queries'
import { taxonomyTerms } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const taxonomyId = getRouterParam(event, 'id')!

  await getTaxonomyByIdOrThrow(db, siteId, taxonomyId)

  const terms = await db.query.taxonomyTerms.findMany({
    where: eq(taxonomyTerms.taxonomyId, taxonomyId),
    columns: { id: true, slug: true, name: true, description: true, parentId: true, createdAt: true },
  })

  return { terms }
})
