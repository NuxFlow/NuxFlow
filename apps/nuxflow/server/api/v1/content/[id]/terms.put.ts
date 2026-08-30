import { z } from 'zod'
import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { getContentItemOrThrow } from '../../../../utils/content-queries'
import { contentTaxonomyTerms, taxonomyTerms, taxonomies } from '@nuxflow/db/schema'
import { and, eq, inArray } from 'drizzle-orm'

const bodySchema = z.object({
  termIds: z.array(z.string()),
})

export default defineEventHandler(async (event) => {
  await requireRole(event, 'author')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const itemId = getRouterParam(event, 'id')!
  const body = await parseBody(event, bodySchema)

  await getContentItemOrThrow(db, siteId, itemId, 'Content item not found', { id: true })

  // Terms must belong to a taxonomy owned by this site — otherwise a caller could link
  // content to another tenant's taxonomy term by supplying its (unguessable but not
  // secret) ULID.
  if (body.termIds.length > 0) {
    const validTerms = await db.select({ id: taxonomyTerms.id })
      .from(taxonomyTerms)
      .innerJoin(taxonomies, eq(taxonomyTerms.taxonomyId, taxonomies.id))
      .where(and(inArray(taxonomyTerms.id, body.termIds), eq(taxonomies.siteId, siteId)))

    if (validTerms.length !== body.termIds.length) {
      throw validationError('One or more termIds do not belong to this site')
    }
  }

  // Replace all term assignments atomically
  await db.delete(contentTaxonomyTerms).where(eq(contentTaxonomyTerms.contentItemId, itemId))

  if (body.termIds.length > 0) {
    await db.insert(contentTaxonomyTerms).values(
      body.termIds.map(termId => ({ contentItemId: itemId, termId })),
    )
  }

  return { success: true }
})
