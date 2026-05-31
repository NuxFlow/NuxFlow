import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { comments } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const existing = await db.query.comments.findFirst({
    where: and(eq(comments.id, id), eq(comments.siteId, siteId)),
  })
  if (!existing) throw createError({ statusCode: 404, message: 'Comment not found' })

  await db.delete(comments).where(eq(comments.id, id))

  return { success: true }
})
