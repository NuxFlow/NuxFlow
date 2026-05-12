import { z } from 'zod'
import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { taxonomies, taxonomyTerms } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'

const bodySchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(200).regex(/^[a-z0-9-]+$/),
  description: z.string().max(500).optional(),
  parentId: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const taxonomyId = getRouterParam(event, 'id')!
  const body = await readValidatedBody(event, bodySchema.parse)

  const taxonomy = await db.query.taxonomies.findFirst({
    where: and(eq(taxonomies.id, taxonomyId), eq(taxonomies.siteId, siteId)),
  })
  if (!taxonomy) throw createError({ statusCode: 404, message: 'Taxonomy not found' })

  const id = ulid()
  await db.insert(taxonomyTerms).values({
    id,
    taxonomyId,
    slug: body.slug,
    name: body.name,
    description: body.description ?? null,
    parentId: body.parentId ?? null,
  })

  setResponseStatus(event, 201)
  return { id }
})
