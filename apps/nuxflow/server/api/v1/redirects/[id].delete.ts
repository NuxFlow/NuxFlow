import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { redirects } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  await db.delete(redirects).where(and(eq(redirects.id, id), eq(redirects.siteId, siteId)))
  return { success: true }
})
