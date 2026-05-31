import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { comments } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

const bodySchema = z.object({
  status: z.enum(['pending', 'approved', 'spam', 'trash']),
})

export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const body = await readValidatedBody(event, bodySchema.parse)

  const existing = await db.query.comments.findFirst({
    where: and(eq(comments.id, id), eq(comments.siteId, siteId)),
  })
  if (!existing) throw createError({ statusCode: 404, message: 'Comment not found' })

  await db.update(comments).set({ status: body.status }).where(eq(comments.id, id))

  return { id, status: body.status }
})
