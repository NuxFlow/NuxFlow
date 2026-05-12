import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { taxonomies } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  isHierarchical: z.boolean().default(false),
})

export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const body = await readValidatedBody(event, bodySchema.parse)

  const existing = await db.query.taxonomies.findFirst({
    where: and(eq(taxonomies.siteId, siteId), eq(taxonomies.slug, body.slug)),
  })
  if (existing) throw createError({ statusCode: 409, message: `Taxonomy slug "${body.slug}" already exists` })

  const id = ulid()
  await db.insert(taxonomies).values({ id, siteId, ...body })

  setResponseStatus(event, 201)
  return { id }
})
