import { z } from 'zod'
import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { contentTaxonomyTerms, contentItems } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

const bodySchema = z.object({
  termIds: z.array(z.string()),
})

export default defineEventHandler(async (event) => {
  await requireRole(event, 'author')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const itemId = getRouterParam(event, 'id')!
  const body = await readValidatedBody(event, bodySchema.parse)

  const item = await db.query.contentItems.findFirst({
    where: and(eq(contentItems.id, itemId), eq(contentItems.siteId, siteId)),
    columns: { id: true },
  })
  if (!item) throw createError({ statusCode: 404, message: 'Content item not found' })

  // Replace all term assignments atomically
  await db.delete(contentTaxonomyTerms).where(eq(contentTaxonomyTerms.contentItemId, itemId))

  if (body.termIds.length > 0) {
    await db.insert(contentTaxonomyTerms).values(
      body.termIds.map(termId => ({ contentItemId: itemId, termId })),
    )
  }

  return { success: true }
})
